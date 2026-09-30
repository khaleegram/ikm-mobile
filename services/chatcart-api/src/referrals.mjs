import { randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import {
  REFERRAL_QUALIFYING_FLOOR_KOBO,
  grantTickets,
  sharesIdentity,
} from './promo.mjs';

/**
 * The referral ladder (spec §5.5).
 *
 * The rules that make this hard to farm, in the spec's own order of importance:
 *
 *  1. **Completed orders count, never invites sent.** Invite-count is the most
 *     farmed mechanic in consumer apps — five dead accounts take a minute.
 *  2. **Only after the dispute window closes**, so a referral cannot rest on an
 *     order that is later refunded.
 *  3. **Distinct identities** across referrer and referee.
 *  4. **A minimum order value**, or five trivial orders unlock the top band.
 *
 * The ladder is one-time and paid in **increments**: passing a tier must not
 * re-issue the whole total, and nobody loses a reward by jumping two tiers at once.
 * The lifetime ceiling of ₦8,000 per referrer falls out of the `tier` unique index
 * rather than being enforced by a counter someone can forget to update.
 */

/** Reward granted the moment each milestone is crossed. Increments, not totals. */
export const REFERRAL_LADDER = Object.freeze([
  Object.freeze({ tier: 1, incrementKobo: 50000, totalKobo: 50000, monthlyTickets: 0, oneTimeTickets: 0 }),
  Object.freeze({ tier: 3, incrementKobo: 100000, totalKobo: 150000, monthlyTickets: 0, oneTimeTickets: 0 }),
  Object.freeze({ tier: 5, incrementKobo: 150000, totalKobo: 300000, monthlyTickets: 0, oneTimeTickets: 1 }),
  Object.freeze({ tier: 10, incrementKobo: 200000, totalKobo: 500000, monthlyTickets: 2, oneTimeTickets: 0 }),
  Object.freeze({ tier: 20, incrementKobo: 300000, totalKobo: 800000, monthlyTickets: 5, oneTimeTickets: 0 }),
]);

/** The lifetime ceiling, derived from the ladder rather than typed twice. */
export const REFERRAL_LIFETIME_MAX_KOBO = REFERRAL_LADDER.reduce(
  (sum, step) => sum + step.incrementKobo,
  0
);

/** What the invited friend gets off their own first order (§5.5). */
export const REFEREE_WELCOME_KOBO = 50000;

function str(value) {
  return String(value ?? '').trim();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function httpError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

/** A shareable code. Ambiguous characters are left out so it can be read aloud. */
export function generateReferralCode(userId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += alphabet[bytes[i] % alphabet.length];
  return `IKM${suffix}`;
}

/**
 * Record that one person invited another.
 *
 * Self-referral is refused here *and* by a database constraint, because the
 * application check is the one that can be bypassed by a racing request.
 */
export async function createReferral({ referrerId, refereeId, code = null }) {
  if (str(referrerId) === str(refereeId)) {
    throw httpError('You cannot refer yourself', 400, 'SELF_REFERRAL');
  }

  // Distinct identities, not merely distinct accounts: §8.3 lists this as one of
  // the load-bearing rules, because one person with two accounts is the cheapest
  // possible farm.
  if (await sharesIdentity(referrerId, refereeId)) {
    throw httpError('That account is linked to yours', 400, 'SAME_IDENTITY');
  }

  const { rows } = await pool.query(
    `INSERT INTO referrals (id, referrer_id, referee_id, code)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (referee_id) DO NOTHING
     RETURNING *`,
    [newId('ref'), referrerId, refereeId, str(code) || null]
  );

  if (!rows.length) {
    // Already referred. Not an error the user needs to see.
    return { success: true, alreadyExists: true };
  }
  return { success: true, referral: rows[0] };
}

/**
 * Whether an order has passed the point where it can still be refunded.
 *
 * This is the "dispute window" §5.5 gates on. Counting earlier would let a referee
 * qualify, earn the reward, and then have the order refunded.
 */
export async function isOrderPastDisputeWindow(orderId) {
  const { rows } = await pool.query(
    `SELECT status, escrow_status, funds_released_at, auto_release_date
       FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) return false;

  const escrow = str(order.escrow_status);
  if (escrow === 'refunded' || escrow === 'refund_pending') return false;
  if (str(order.status) === 'Cancelled') return false;

  if (order.funds_released_at) return true;
  if (order.auto_release_date && new Date(order.auto_release_date) <= new Date()) return true;
  return false;
}

/**
 * Mark a referral as qualified, once its order has cleared the window.
 *
 * Returns the newly crossed milestones, so the caller can surface "you just earned
 * ₦1,000" at the moment it happens rather than on a later visit.
 */
export async function qualifyReferralForOrder({ refereeId, orderId, itemSubtotalKobo }) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM referrals WHERE referee_id = $1 LIMIT 1`,
    [refereeId]
  );
  const referral = existing[0];
  if (!referral) return { qualified: false, reason: 'NOT_REFERRED' };
  if (referral.status === 'qualified') return { qualified: false, reason: 'ALREADY_QUALIFIED' };

  // Minimum order value: without it, five trivial orders unlock the top band (§5.5).
  if (Number(itemSubtotalKobo) < REFERRAL_QUALIFYING_FLOOR_KOBO) {
    return {
      qualified: false,
      reason: 'BELOW_MINIMUM',
      minimumKobo: REFERRAL_QUALIFYING_FLOOR_KOBO,
    };
  }

  if (!(await isOrderPastDisputeWindow(orderId))) {
    return { qualified: false, reason: 'DISPUTE_WINDOW_OPEN' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE referrals
          SET status = 'qualified', qualifying_order_id = $2, qualified_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [referral.id, orderId]
    );
    await client.query('COMMIT');
    if (!rows.length) return { qualified: false, reason: 'ALREADY_QUALIFIED' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const crossed = await grantCrossedMilestones(referral.referrer_id);
  return { qualified: true, referrerId: referral.referrer_id, milestones: crossed };
}

/**
 * Grant every milestone the referrer has now reached but was not granted.
 *
 * Iterates the whole ladder rather than only the tier just crossed, because five
 * referrals arriving across three requests must still produce exactly one grant per
 * tier. The unique index on `(referrer_id, tier)` is what makes that true even if
 * two of those requests run at the same instant.
 */
export async function grantCrossedMilestones(referrerId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS qualified FROM referrals
      WHERE referrer_id = $1 AND status = 'qualified'`,
    [referrerId]
  );
  const qualified = rows[0]?.qualified || 0;

  const granted = [];
  for (const step of REFERRAL_LADDER) {
    if (qualified < step.tier) break;

    const { rows: inserted } = await pool.query(
      `INSERT INTO referral_reward_grants (id, referrer_id, tier, amount_kobo)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (referrer_id, tier) DO NOTHING
       RETURNING *`,
      [newId('rrg'), referrerId, step.tier, step.incrementKobo]
    );
    if (!inserted.length) continue; // already granted; never re-issued

    granted.push({ tier: step.tier, amountKobo: step.incrementKobo, totalKobo: step.totalKobo });

    if (step.oneTimeTickets) {
      // One-time, so the source is fixed and the unique index makes it once ever.
      await grantTickets({ userId: referrerId, source: `referral_tier${step.tier}`, quantity: step.oneTimeTickets });
    }
  }

  // Monthly tickets recur, so top them up for the current month.
  await grantMonthlyReferralTickets(referrerId, qualified);
  return granted;
}

/**
 * Top up the recurring ticket entitlement for this calendar month.
 *
 * Idempotent per month: the month end is used as the expiry, so it doubles as the
 * uniqueness key and the tickets expire with the month that granted them.
 */
export async function grantMonthlyReferralTickets(referrerId, qualifiedOverride = null) {
  let qualified = qualifiedOverride;
  if (qualified == null) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS qualified FROM referrals
        WHERE referrer_id = $1 AND status = 'qualified'`,
      [referrerId]
    );
    qualified = rows[0]?.qualified || 0;
  }

  const monthly = REFERRAL_LADDER.reduce(
    (best, step) => (qualified >= step.tier ? Math.max(best, step.monthlyTickets) : best),
    0
  );
  if (!monthly) return [];

  // Tickets expire with the month that granted them, and the month is also the
  // grant period, so a top-up is idempotent within a month and recurs next month
  // rather than accumulating.
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  return grantTickets({
    userId: referrerId,
    source: 'referral_monthly',
    quantity: monthly,
    expiresAt: end.toISOString(),
    period,
  });
}

/** What the referrer has earned, earned-but-unspent, and still has to reach. */
export async function getReferralProgress(referrerId) {
  const [{ rows: counts }, { rows: grants }] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE status = 'qualified')::int AS qualified,
         count(*) FILTER (WHERE status = 'pending')::int   AS pending
       FROM referrals WHERE referrer_id = $1`,
      [referrerId]
    ),
    pool.query(
      `SELECT * FROM referral_reward_grants
        WHERE referrer_id = $1 ORDER BY granted_at DESC`,
      [referrerId]
    ),
  ]);

  const qualified = counts[0]?.qualified || 0;
  const earnedKobo = grants.reduce((sum, row) => sum + Number(row.amount_kobo), 0);
  const unspent = grants.filter((row) => !row.redeemed_at);
  const spendableKobo = unspent.reduce((sum, row) => sum + Number(row.amount_kobo), 0);

  const nextStep = REFERRAL_LADDER.find((step) => qualified < step.tier) || null;

  return {
    qualified,
    pending: counts[0]?.pending || 0,
    earnedKobo,
    spendableKobo,
    lifetimeMaxKobo: REFERRAL_LIFETIME_MAX_KOBO,
    grants,
    nextMilestone: nextStep
      ? { tier: nextStep.tier, remaining: nextStep.tier - qualified, rewardKobo: nextStep.incrementKobo }
      : null,
  };
}

/**
 * Mark the oldest unspent reward as spent on this order.
 *
 * The redemption floor in §5.5.1 is checked by the promo layer before this runs, so
 * a ₦500 reward can never be spent on a ₦2,500 order — the ratio the spec calls the
 * worst case.
 */
export async function redeemReferralReward({ referrerId, orderId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, amount_kobo FROM referral_reward_grants
        WHERE referrer_id = $1 AND redeemed_at IS NULL
        ORDER BY granted_at ASC
        FOR UPDATE
        LIMIT 1`,
      [referrerId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: updated } = await client.query(
      `UPDATE referral_reward_grants
          SET redeemed_at = now(), redeemed_order_id = $2
        WHERE id = $1
        RETURNING *`,
      [rows[0].id, orderId]
    );
    await client.query('COMMIT');
    return updated[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Undo a redemption when the order it was spent on is refunded. */
export async function releaseReferralRewardForOrder(orderId) {
  const { rows } = await pool.query(
    `UPDATE referral_reward_grants
        SET redeemed_at = NULL, redeemed_order_id = NULL
      WHERE redeemed_order_id = $1
      RETURNING id`,
    [orderId]
  );
  return rows.length;
}

/**
 * Referrers who have reached a milestone that was never granted.
 *
 * Qualification is driven by the order lifecycle, which can be interrupted, so the
 * ladder is made eventual by sweeping this rather than being best-effort at the
 * moment of qualification.
 */
export async function listReferrersNeedingMilestoneSweep(limit = 200) {
  const tiers = REFERRAL_LADDER.map((step) => step.tier);
  const { rows } = await pool.query(
    `WITH reached AS (
       SELECT referrer_id, count(*)::int AS qualified
         FROM referrals
        WHERE status = 'qualified'
        GROUP BY referrer_id
     )
     SELECT r.referrer_id
       FROM reached r
       JOIN LATERAL (
         SELECT tier
           FROM unnest($1::int[]) AS tier
          WHERE tier <= r.qualified
          ORDER BY tier DESC
          LIMIT 1
       ) highest ON true
      WHERE NOT EXISTS (
        SELECT 1 FROM referral_reward_grants g
         WHERE g.referrer_id = r.referrer_id AND g.tier = highest.tier
      )
      LIMIT $2`,
    [tiers, limit]
  );
  return rows.map((row) => row.referrer_id);
}
