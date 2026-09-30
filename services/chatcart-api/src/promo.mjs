import { createHmac, randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import { config, isIdentityHashConfigured, isPaystackConfigured } from './config.mjs';
import { fetchBalance } from './paystack.mjs';
import { resolveTiers } from './commission.mjs';
import {
  DEFAULT_PROMO_CONFIG,
  computeOrderQuote,
  promoCapKobo,
  promoDiscountKobo,
  promoRequiresTicket,
} from './pricing.mjs';
import { getSellerPayableBalance } from './escrow.mjs';

/**
 * Promo campaigns, tickets, identity, the ledger and the budget.
 *
 * ## The idea that matters
 *
 * A discount is **configuration an operator owns**, not a product behaviour. The
 * engine never decides what a campaign is worth; it reads a `promo_campaigns` row
 * and applies it. So the same code runs "10% off anything", "₦2,000 off orders over
 * ₦20,000", or "15% off a first order, capped at ₦15,000" — and switching one on,
 * changing its percentage, or raising its budget is a database update that checkout
 * picks up immediately.
 *
 * Three rules hold throughout:
 *
 *  1. **A discount is platform money, never seller money.** The seller is paid their
 *     full price; the platform funds the gap (spec §5, §6).
 *  2. **The gap must exist as cash.** A liability recorded in a table does not fund a
 *     transfer, so the budget is a reserved balance (§6.3) and issuance stops when it
 *     is not fundable. It fails closed.
 *  3. **Disabled means disabled.** A campaign that is off, archived, scheduled or
 *     expired is never returned to checkout.
 */

// ── Constants that are genuinely fixed ─────────────────────────────────────

export const PROMO_TYPE_AWOOF = 'awoof';
export const PROMO_TYPE_REFERRAL = 'referral';
export const STANDARD_RELEASE_WINDOW_DAYS = 2;

/**
 * A referral reward is only redeemable at or above this item price (§5.5.1), and an
 * order must reach it to *count* toward the ladder (§5.5). One number, so there is
 * one thing to explain.
 */
export const REFERRAL_REDEMPTION_FLOOR_KOBO = Number(
  process.env.REFERRAL_REDEMPTION_FLOOR_KOBO || 1000000
);
export const REFERRAL_QUALIFYING_FLOOR_KOBO = Number(
  process.env.REFERRAL_QUALIFYING_FLOOR_KOBO || REFERRAL_REDEMPTION_FLOOR_KOBO
);

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

/**
 * The fallback release window, in days.
 *
 * Spec §7.1: a subsidised order is held longer, because a longer hold is what makes
 * cycling subsidy expensive. The length belongs to the campaign that funded the
 * order, so it is read from there rather than assumed.
 */
export function releaseWindowDaysFor(fundingSourceOrCampaign = 'buyer') {
  const value =
    typeof fundingSourceOrCampaign === 'object' && fundingSourceOrCampaign !== null
      ? fundingSourceOrCampaign.releaseWindowDays
      : null;
  if (Number.isInteger(value)) return value;
  return fundingSourceOrCampaign && fundingSourceOrCampaign !== 'buyer'
    ? DEFAULT_PROMO_CONFIG.releaseWindowDays
    : STANDARD_RELEASE_WINDOW_DAYS;
}

export function autoReleaseDateFor({ sentAt = new Date(), fundingSourceOrCampaign = 'buyer' } = {}) {
  const days = releaseWindowDaysFor(fundingSourceOrCampaign);
  return new Date(new Date(sentAt).getTime() + days * 24 * 60 * 60 * 1000);
}

// ── Identity (§8.1, §8.2, §8.3) ────────────────────────────────────────────

/**
 * A stable, non-reversible key for an identity.
 *
 * Keyed rather than plain hashing: an eleven-digit BVN has only 10^11 possible
 * values, so an unsalted digest is brute-forceable in minutes. With a server-held
 * secret the stored value is useless to anyone holding only the database.
 */
function hashIdentity(value) {
  const clean = str(value);
  if (!clean) return null;
  if (!isIdentityHashConfigured()) {
    throw httpError(
      'IDENTITY_HASH_SECRET is not configured, so identities cannot be stored safely',
      503,
      'identity_hash_not_configured'
    );
  }
  return createHmac('sha256', config.identityHashSecret).update(clean).digest('hex');
}

/**
 * The key that caps and tickets are counted against.
 *
 * Deliberately **not** the user id. Spec §8.3 makes caps keyed to identity
 * load-bearing: keyed to an account, every limit is bypassed by registering again.
 */
export async function identityKeyFor(userId) {
  const { rows } = await pool.query(
    `SELECT bvn_hash, nin_hash, bank_account_hash FROM user_identities WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  const verified = row?.bvn_hash || row?.nin_hash;
  if (verified) return `idv:${verified}`;
  return `uid:${userId}`;
}

/**
 * Store a buyer's verified identity.
 *
 * The unique indexes on all three hashes mean a second account claiming the same
 * BVN, NIN or bank account is rejected by Postgres rather than by a check someone
 * can forget to run. That is the whole guardrail (§8.3).
 */
export async function recordVerifiedIdentity({ userId, bvn, nin, bankAccount }) {
  const bvnHash = hashIdentity(bvn);
  const ninHash = hashIdentity(nin);
  const bankHash = hashIdentity(bankAccount);

  if (!bvnHash && !ninHash && !bankHash) {
    throw httpError('At least one identity document is required', 400);
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO user_identities (user_id, bvn_hash, nin_hash, bank_account_hash, verified_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         bvn_hash          = COALESCE(EXCLUDED.bvn_hash, user_identities.bvn_hash),
         nin_hash          = COALESCE(EXCLUDED.nin_hash, user_identities.nin_hash),
         bank_account_hash = COALESCE(EXCLUDED.bank_account_hash, user_identities.bank_account_hash),
         verified_at       = COALESCE(user_identities.verified_at, now()),
         updated_at        = now()
       RETURNING user_id, verified_at`,
      [userId, bvnHash, ninHash, bankHash]
    );
    return { success: true, userId: rows[0].user_id, verifiedAt: rows[0].verified_at };
  } catch (error) {
    if (error?.code === '23505') {
      // Deliberately vague: it should not confirm a stranger's BVN.
      throw httpError(
        'That identity document is already linked to another account',
        409,
        'IDENTITY_IN_USE'
      );
    }
    throw error;
  }
}

/** Whether two users share a verified identity. The self-dealing check (§8.3). */
export async function sharesIdentity(userA, userB) {
  if (str(userA) === str(userB)) return true;
  const { rows } = await pool.query(
    `SELECT 1
       FROM user_identities a
       JOIN user_identities b
         ON (a.bvn_hash IS NOT NULL AND a.bvn_hash = b.bvn_hash)
         OR (a.nin_hash IS NOT NULL AND a.nin_hash = b.nin_hash)
         OR (a.bank_account_hash IS NOT NULL AND a.bank_account_hash = b.bank_account_hash)
      WHERE a.user_id = $1 AND b.user_id = $2
      LIMIT 1`,
    [userA, userB]
  );
  return rows.length > 0;
}

export async function markPhoneVerified(userId, phone) {
  await pool.query(
    `INSERT INTO user_identities (user_id, phone, phone_verified_at)
     VALUES ($1,$2, now())
     ON CONFLICT (user_id) DO UPDATE SET
       phone = EXCLUDED.phone,
       phone_verified_at = COALESCE(user_identities.phone_verified_at, now()),
       updated_at = now()`,
    [userId, str(phone) || null]
  );
  return { success: true };
}

// ── Tickets (§5.2, §5.3) — an optional scarcity mechanic ───────────────────

/**
 * Ensure the one lifetime baseline ticket exists.
 *
 * Only meaningful for campaigns that ask for tickets, but harmless otherwise, so it
 * runs on first look and the top of a ticketed campaign is reachable on a first
 * order rather than reserved for people who have already spent a lot.
 */
export async function ensureBaselineTicket(userId) {
  const identityKey = await identityKeyFor(userId);
  await pool.query(
    `INSERT INTO promo_tickets (id, identity_key, user_id, source, status, grant_key)
     VALUES ($1,$2,$3,'baseline','available',$4)
     ON CONFLICT (grant_key) DO NOTHING`,
    [newId('tk'), identityKey, userId, `baseline:${identityKey}:once:0`]
  );
  return identityKey;
}

/**
 * Grant tickets.
 *
 * The grant key carries the slot, so a tier that awards two tickets actually awards
 * two while still being idempotent. Keying only on (identity, source, period) would
 * silently drop every ticket after the first.
 */
export async function grantTickets({ userId, source, quantity = 1, expiresAt = null, period = null }) {
  if (quantity <= 0) return [];
  const identityKey = await identityKeyFor(userId);
  const cleanSource = str(source) || 'grant';
  const slotPeriod = period || 'once';

  const granted = [];
  for (let slot = 0; slot < quantity; slot += 1) {
    const { rows } = await pool.query(
      `INSERT INTO promo_tickets (id, identity_key, user_id, source, status, expires_at, grant_key)
       VALUES ($1,$2,$3,$4,'available',$5,$6)
       ON CONFLICT (grant_key) DO NOTHING
       RETURNING id`,
      [
        newId('tk'),
        identityKey,
        userId,
        cleanSource,
        expiresAt,
        `${cleanSource}:${identityKey}:${slotPeriod}:${slot}`,
      ]
    );
    if (rows.length) granted.push(rows[0].id);
  }
  return granted;
}

export async function listTickets(userId) {
  const identityKey = await identityKeyFor(userId);
  const { rows } = await pool.query(
    `SELECT id, source, status, granted_at, expires_at, used_at, order_id
       FROM promo_tickets WHERE identity_key = $1 ORDER BY granted_at DESC`,
    [identityKey]
  );
  return {
    identityKey,
    tickets: rows,
    available: rows.filter(
      (row) => row.status === 'available' && (!row.expires_at || new Date(row.expires_at) > new Date())
    ).length,
  };
}

export async function availableTicketCount(userId) {
  const identityKey = await identityKeyFor(userId);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS available FROM promo_tickets
      WHERE identity_key = $1 AND status = 'available'
        AND (expires_at IS NULL OR expires_at > now())`,
    [identityKey]
  );
  return rows[0]?.available || 0;
}

async function consumeTicket(client, { userId, orderId }) {
  const identityKey = await identityKeyFor(userId);
  const { rows } = await client.query(
    `SELECT id FROM promo_tickets
      WHERE identity_key = $1 AND status = 'available'
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY granted_at ASC FOR UPDATE LIMIT 1`,
    [identityKey]
  );
  if (!rows.length) return null;
  await client.query(
    `UPDATE promo_tickets SET status = 'used', used_at = now(), order_id = $2 WHERE id = $1`,
    [rows[0].id, orderId]
  );
  return rows[0].id;
}

/** Return a ticket spent on an order that never completed. */
export async function releaseTicketForOrder(orderId) {
  const { rows } = await pool.query(
    `UPDATE promo_tickets SET status = 'available', used_at = NULL, order_id = NULL
      WHERE order_id = $1 AND status = 'used' RETURNING id`,
    [orderId]
  );
  return rows.length;
}

// ── Campaign storage ───────────────────────────────────────────────────────
//
// Defined in commission-adjacent terms so checkout has one place to look. The
// shape checks live beside them because a campaign that cannot be priced should be
// refused at the door.

const CAMPAIGN_COLUMNS = {
  code: 'code', name: 'name', description: 'description', enabled: 'enabled',
  discountBps: 'discount_bps', capBps: 'cap_bps', capFloorKobo: 'cap_floor_kobo',
  capCeilingKobo: 'cap_ceiling_kobo', capFlatKobo: 'cap_flat_kobo',
  firstOrderOnly: 'first_order_only', minOrderKobo: 'min_order_kobo',
  requiresTicket: 'requires_ticket', ticketThresholdKobo: 'ticket_threshold_kobo',
  maxRedemptions: 'max_redemptions', maxRedemptionsPerIdentity: 'max_redemptions_per_identity',
  budgetKobo: 'budget_kobo', dailyPacingKobo: 'daily_pacing_kobo',
  perSellerCapKobo: 'per_seller_cap_kobo', startsAt: 'starts_at', endsAt: 'ends_at',
  releaseWindowDays: 'release_window_days',
};

/**
 * How long a read of the live campaigns may be reused.
 *
 * Short on purpose. The cache is per-process, so a write from another instance (or
 * a second API replica) cannot invalidate it — the TTL *is* the worst-case delay
 * before a toggle takes effect everywhere. "Disabled means disabled" has to be
 * true within seconds, not within a deploy, because switching a campaign off is
 * what an operator does when something is going wrong.
 *
 * `invalidateCampaignCache()` still runs on every write in this process, so the
 * common case — one operator, one instance — is immediate.
 */
const CACHE_TTL_MS = 5_000;

let cachedLive = { at: 0, campaigns: [] };

export function invalidateCampaignCache() {
  cachedLive = { at: 0, campaigns: [] };
}

export function normaliseCode(code) {
  return str(code).toUpperCase().replace(/\s+/g, '');
}

/** Shape checks. A campaign that cannot be priced is refused, not repaired. */
export function validateCampaign(input = {}) {
  const problems = [];
  const bps = (value) => Number.isInteger(value) && value >= 0 && value <= 10000;
  const kobo = (value) => value == null || (Number.isInteger(value) && value >= 0);

  if (!str(input.code)) problems.push('A code is required');
  else if (!/^[A-Z0-9_-]{3,24}$/.test(normaliseCode(input.code))) {
    problems.push('The code must be 3–24 characters: letters, numbers, dash or underscore');
  }
  if (!str(input.name)) problems.push('A name is required');
  if (!bps(input.discountBps ?? DEFAULT_PROMO_CONFIG.discountBps)) problems.push('discountBps must be 0–10000');
  if (!bps(input.capBps ?? DEFAULT_PROMO_CONFIG.capBps)) problems.push('capBps must be 0–10000');
  if (!kobo(input.capFloorKobo)) problems.push('capFloorKobo must be a non-negative integer');
  if (!kobo(input.capCeilingKobo)) problems.push('capCeilingKobo must be a non-negative integer');
  if (!kobo(input.capFlatKobo)) problems.push('capFlatKobo must be a non-negative integer or null');
  if (!kobo(input.budgetKobo)) problems.push('budgetKobo must be a non-negative integer');

  const floor = input.capFloorKobo ?? DEFAULT_PROMO_CONFIG.capFloorKobo;
  const ceiling = input.capCeilingKobo ?? DEFAULT_PROMO_CONFIG.capCeilingKobo;
  if (Number.isInteger(floor) && Number.isInteger(ceiling) && ceiling < floor) {
    problems.push('The cap ceiling cannot be below the cap floor');
  }
  if (input.capFlatKobo == null && bps(input.discountBps ?? 1500) && bps(input.capBps ?? 500)) {
    if ((input.capBps ?? 500) >= (input.discountBps ?? 1500)) {
      problems.push('capBps is at or above discountBps, so the cap could never apply');
    }
  }

  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) problems.push('startsAt is not a valid date');
  if (endsAt && Number.isNaN(endsAt.getTime())) problems.push('endsAt is not a valid date');
  if (startsAt && endsAt && endsAt <= startsAt) problems.push('endsAt must be after startsAt');

  const days = input.releaseWindowDays;
  if (days != null && (!Number.isInteger(days) || days < 0 || days > 90)) {
    problems.push('releaseWindowDays must be 0–90');
  }
  if (input.maxRedemptions != null && !(Number.isInteger(input.maxRedemptions) && input.maxRedemptions > 0)) {
    problems.push('maxRedemptions must be a positive integer or null');
  }
  if (
    input.maxRedemptionsPerIdentity != null &&
    !(Number.isInteger(input.maxRedemptionsPerIdentity) && input.maxRedemptionsPerIdentity > 0)
  ) {
    problems.push('maxRedemptionsPerIdentity must be a positive integer or null');
  }

  return { ok: problems.length === 0, problems };
}

function rowToCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    archivedAt: row.archived_at,
    discountBps: row.discount_bps,
    capBps: row.cap_bps,
    capFloorKobo: Number(row.cap_floor_kobo),
    capCeilingKobo: Number(row.cap_ceiling_kobo),
    capFlatKobo: row.cap_flat_kobo == null ? null : Number(row.cap_flat_kobo),
    firstOrderOnly: row.first_order_only,
    minOrderKobo: Number(row.min_order_kobo),
    requiresTicket: row.requires_ticket,
    ticketThresholdKobo: Number(row.ticket_threshold_kobo),
    maxRedemptions: row.max_redemptions,
    maxRedemptionsPerIdentity: row.max_redemptions_per_identity,
    budgetKobo: Number(row.budget_kobo),
    dailyPacingKobo: row.daily_pacing_kobo == null ? null : Number(row.daily_pacing_kobo),
    perSellerCapKobo: row.per_seller_cap_kobo == null ? null : Number(row.per_seller_cap_kobo),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    releaseWindowDays: row.release_window_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isCampaignLive(campaign, at = new Date()) {
  if (!campaign || !campaign.enabled || campaign.archivedAt) return false;
  if (campaign.startsAt && new Date(campaign.startsAt) > at) return false;
  if (campaign.endsAt && new Date(campaign.endsAt) <= at) return false;
  return true;
}

/** Why a campaign is not live, so an admin screen can say which. */
export function campaignStatus(campaign, at = new Date()) {
  if (!campaign) return 'missing';
  if (campaign.archivedAt) return 'archived';
  if (!campaign.enabled) return 'disabled';
  if (campaign.startsAt && new Date(campaign.startsAt) > at) return 'scheduled';
  if (campaign.endsAt && new Date(campaign.endsAt) <= at) return 'ended';
  return 'live';
}

export async function listCampaigns({ includeArchived = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM promo_campaigns
      ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
      ORDER BY created_at DESC`
  );
  const spend = await spendByCampaign();
  return rows.map((row) => {
    const campaign = rowToCampaign(row);
    const spent = spend[campaign.id] || 0;
    return {
      ...campaign,
      status: campaignStatus(campaign),
      spentKobo: spent,
      remainingKobo: Math.max(0, campaign.budgetKobo - spent),
    };
  });
}

/** Campaigns checkout may apply right now. Cached briefly; see CACHE_TTL_MS. */
export async function listLiveCampaigns(at = new Date()) {
  if (cachedLive.campaigns.length && Date.now() - cachedLive.at < CACHE_TTL_MS) {
    return cachedLive.campaigns;
  }
  const { rows } = await pool.query(
    `SELECT * FROM promo_campaigns
      WHERE enabled = true AND archived_at IS NULL
        AND (starts_at IS NULL OR starts_at <= $1)
        AND (ends_at IS NULL OR ends_at > $1)
      ORDER BY created_at ASC`,
    [at]
  );
  const campaigns = rows.map(rowToCampaign);
  cachedLive = { at: Date.now(), campaigns };
  return campaigns;
}

export async function findLiveCampaignByCode(code, at = new Date()) {
  const normalised = normaliseCode(code);
  if (!normalised) return null;
  const live = await listLiveCampaigns(at);
  return live.find((campaign) => normaliseCode(campaign.code) === normalised) || null;
}

export async function getCampaign(id) {
  const { rows } = await pool.query(`SELECT * FROM promo_campaigns WHERE id = $1`, [id]);
  return rowToCampaign(rows[0]);
}

export async function createCampaign(input, { createdBy = null } = {}) {
  const check = validateCampaign(input);
  if (!check.ok) throw httpError(check.problems.join('; '), 400, 'INVALID_CAMPAIGN');

  const id = input.id || newId('pc');
  const { rows } = await pool.query(
    `INSERT INTO promo_campaigns (
       id, code, name, description, enabled,
       discount_bps, cap_bps, cap_floor_kobo, cap_ceiling_kobo, cap_flat_kobo,
       first_order_only, min_order_kobo, requires_ticket, ticket_threshold_kobo,
       max_redemptions, max_redemptions_per_identity,
       budget_kobo, daily_pacing_kobo, per_seller_cap_kobo,
       starts_at, ends_at, release_window_days, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      id, normaliseCode(input.code), str(input.name), str(input.description) || null,
      Boolean(input.enabled),
      input.discountBps ?? DEFAULT_PROMO_CONFIG.discountBps,
      input.capBps ?? DEFAULT_PROMO_CONFIG.capBps,
      input.capFloorKobo ?? DEFAULT_PROMO_CONFIG.capFloorKobo,
      input.capCeilingKobo ?? DEFAULT_PROMO_CONFIG.capCeilingKobo,
      input.capFlatKobo ?? null,
      input.firstOrderOnly ?? true,
      input.minOrderKobo ?? 0,
      Boolean(input.requiresTicket),
      input.ticketThresholdKobo ?? DEFAULT_PROMO_CONFIG.ticketThresholdKobo,
      input.maxRedemptions ?? null,
      input.maxRedemptionsPerIdentity ?? null,
      input.budgetKobo ?? 0,
      input.dailyPacingKobo ?? null,
      input.perSellerCapKobo ?? null,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.releaseWindowDays ?? DEFAULT_PROMO_CONFIG.releaseWindowDays,
      createdBy,
    ]
  );

  if (Number(input.budgetKobo) > 0) {
    await recordBudgetMovement({
      campaignId: id,
      kind: 'reserve',
      amountKobo: Number(input.budgetKobo),
      note: 'Opening budget',
      createdBy,
    });
  }

  invalidateCampaignCache();
  return rowToCampaign(rows[0]);
}

/** Update a campaign. Only the fields supplied are touched. */
export async function updateCampaign(id, patch, { updatedBy = null } = {}) {
  const existing = await getCampaign(id);
  if (!existing) throw httpError('That campaign does not exist', 404, 'NOT_FOUND');

  const check = validateCampaign({ ...existing, ...patch });
  if (!check.ok) throw httpError(check.problems.join('; '), 400, 'INVALID_CAMPAIGN');

  const coerce = {
    code: () => normaliseCode(patch.code),
    name: () => str(patch.name),
    description: () => str(patch.description) || null,
    enabled: () => Boolean(patch.enabled),
    firstOrderOnly: () => Boolean(patch.firstOrderOnly),
    requiresTicket: () => Boolean(patch.requiresTicket),
  };

  const sets = [];
  const values = [id];
  for (const [key, column] of Object.entries(CAMPAIGN_COLUMNS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    values.push(coerce[key] ? coerce[key]() : patch[key]);
    sets.push(`${column} = $${values.length}`);
  }

  if (!sets.length) return existing;

  const { rows } = await pool.query(
    `UPDATE promo_campaigns SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 RETURNING *`,
    values
  );

  // A budget change is real money, so it goes on the ledger. The column is
  // authoritative; the ledger is what makes it auditable.
  if (Object.prototype.hasOwnProperty.call(patch, 'budgetKobo')) {
    const delta = Number(patch.budgetKobo) - existing.budgetKobo;
    if (delta !== 0) {
      await recordBudgetMovement({
        campaignId: id,
        kind: delta > 0 ? 'topup' : 'withdrawal',
        amountKobo: delta,
        note: delta > 0 ? 'Budget increased' : 'Budget reduced',
        createdBy: updatedBy,
      });
    }
  }

  invalidateCampaignCache();
  return rowToCampaign(rows[0]);
}

/** Switch a campaign on or off. The action an operator reaches for most. */
export async function setCampaignEnabled(id, enabled) {
  const { rows } = await pool.query(
    `UPDATE promo_campaigns SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, Boolean(enabled)]
  );
  if (!rows.length) throw httpError('That campaign does not exist', 404, 'NOT_FOUND');
  invalidateCampaignCache();
  return rowToCampaign(rows[0]);
}

/** Archive rather than delete, so its redemptions keep their explanation. */
export async function archiveCampaign(id) {
  const { rows } = await pool.query(
    `UPDATE promo_campaigns SET enabled = false, archived_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!rows.length) throw httpError('That campaign does not exist', 404, 'NOT_FOUND');
  invalidateCampaignCache();
  return rowToCampaign(rows[0]);
}

// ── Budget (§6.3) ─────────────────────────────────────────────────────────

export async function recordBudgetMovement({
  campaignId = null,
  kind,
  amountKobo,
  note = null,
  createdBy = null,
  orderId = null,
}) {
  const amount = Number(amountKobo);
  if (!Number.isInteger(amount)) throw httpError('Budget movements must be integer kobo', 400);
  const { rows } = await pool.query(
    `INSERT INTO promo_budget_ledger (id, promo_campaign_id, kind, amount_kobo, note, created_by, order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [newId('pbg'), campaignId, kind, amount, note, createdBy, orderId]
  );
  return rows[0];
}

export async function spendByCampaign() {
  const { rows } = await pool.query(
    `SELECT promo_campaign_id AS id,
            COALESCE(SUM(platform_contribution_kobo), 0)::bigint AS spent
       FROM promo_redemptions WHERE promo_campaign_id IS NOT NULL
      GROUP BY promo_campaign_id`
  );
  const map = {};
  for (const row of rows) map[row.id] = Number(row.spent);
  return map;
}

export async function campaignSpendKobo(campaignId, { since = null } = {}) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(platform_contribution_kobo), 0)::bigint AS spent
       FROM promo_redemptions
      WHERE promo_campaign_id = $1 AND ($2::timestamptz IS NULL OR created_at >= $2)`,
    [campaignId, since]
  );
  return Number(rows[0]?.spent || 0);
}

export async function campaignRemainingKobo(campaignOrId) {
  const campaign = typeof campaignOrId === 'object' ? campaignOrId : await getCampaign(campaignOrId);
  if (!campaign) return 0;
  const spent = await campaignSpendKobo(campaign.id);
  return Math.max(0, campaign.budgetKobo - spent);
}

/** Every campaign's remaining budget, for the reserved-balance check. */
export async function totalRemainingBudgetKobo() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(budget_kobo), 0)::bigint AS budget
       FROM promo_campaigns WHERE enabled = true AND archived_at IS NULL`
  );
  const budget = Number(rows[0]?.budget || 0);
  const { rows: spentRows } = await pool.query(
    `SELECT COALESCE(SUM(r.platform_contribution_kobo), 0)::bigint AS spent
       FROM promo_redemptions r
       JOIN promo_campaigns c ON c.id = r.promo_campaign_id
      WHERE c.enabled = true AND c.archived_at IS NULL`
  );
  return Math.max(0, budget - Number(spentRows[0]?.spent || 0));
}

export async function spendTodayKobo() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(platform_contribution_kobo), 0)::bigint AS spent
       FROM promo_redemptions WHERE created_at >= $1`,
    [start]
  );
  return Number(rows[0]?.spent || 0);
}

export async function sellerCampaignSpendKobo(campaignId, sellerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(platform_contribution_kobo), 0)::bigint AS spent
       FROM promo_redemptions WHERE promo_campaign_id = $1 AND seller_id = $2`,
    [campaignId, sellerId]
  );
  return Number(rows[0]?.spent || 0);
}

export async function listBudgetLedger({ campaignId = null, limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM promo_budget_ledger
      WHERE ($1::text IS NULL OR promo_campaign_id = $1)
      ORDER BY created_at DESC LIMIT $2`,
    [campaignId, Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

/**
 * Spec §6.3, checked continuously and before every issuance.
 *
 * ```
 * available Paystack balance  ≥  seller-owed escrow
 *                             +  committed payouts
 *                             +  unspent promo budget
 * ```
 *
 * This is the one check that stops the marketplace accepting orders it cannot fund
 * on release. When it fails, issuance pauses rather than proceeding optimistically.
 */
export async function reconcileReservedBalance() {
  const unspentBudgetKobo = await totalRemainingBudgetKobo();

  const { rows: owedRows } = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(seller_payout_kobo, 0)), 0)::bigint AS owed
       FROM orders WHERE escrow_status = 'held'`
  );
  const sellerOwedKobo = Number(owedRows[0]?.owed || 0);

  const { rows: payoutRows } = await pool.query(
    `SELECT COALESCE(SUM(amount * 100), 0)::bigint AS committed
       FROM payouts WHERE status IN ('pending','pending_otp')`
  );
  const committedPayoutsKobo = Number(payoutRows[0]?.committed || 0);

  const requiredKobo = sellerOwedKobo + committedPayoutsKobo + unspentBudgetKobo;

  let balanceKobo = null;
  let balanceKnown = false;
  if (isPaystackConfigured()) {
    try {
      balanceKobo = (await fetchBalance()).balanceKobo;
      balanceKnown = true;
    } catch (error) {
      console.error('Reserved-balance check could not read the Paystack balance:', error?.message);
    }
  }

  return {
    balanceKnown,
    availableBalanceKobo: balanceKobo,
    sellerOwedKobo,
    committedPayoutsKobo,
    unspentBudgetKobo,
    requiredKobo,
    shortfallKobo: balanceKnown ? Math.max(0, requiredKobo - balanceKobo) : null,
    // Fail closed: no balance means no authorisation.
    fundable: balanceKnown ? balanceKobo >= requiredKobo : false,
  };
}

// ── Eligibility ───────────────────────────────────────────────────────────

/**
 * Whether a campaign may be applied to this order, and for how much.
 *
 * Every refusal carries a machine-readable `code` so the checkout modal can say why
 * and when it resets — "code not accepted" is exactly the dead end §11.3 warns about.
 */
export async function evaluateCampaign({ campaign, buyerId, sellerId, itemsSubtotalKobo }) {
  const subtotal = Number(itemsSubtotalKobo);
  const refuse = (code, message, extra = {}) => ({
    eligible: false,
    code,
    message,
    discountKobo: 0,
    requiresTicket: false,
    ...extra,
  });

  if (!campaign || !isCampaignLive(campaign)) {
    return refuse('NOT_AVAILABLE', 'That code is not available right now');
  }

  // Self-dealing is the fraud the whole model is built around (§7), and it is one
  // line to attempt.
  if (await sharesIdentity(buyerId, sellerId)) {
    return refuse('SELF_DEALING', 'This code cannot be used on your own listing', { hardBlock: true });
  }

  if (subtotal < campaign.minOrderKobo) {
    return refuse(
      'BELOW_MINIMUM',
      `This code needs an order of ₦${(campaign.minOrderKobo / 100).toLocaleString()} or more`,
      { minimumKobo: campaign.minOrderKobo }
    );
  }

  if (campaign.firstOrderOnly) {
    const { rows } = await pool.query(
      `SELECT 1 FROM orders WHERE customer_id = $1 AND status <> 'Cancelled' LIMIT 1`,
      [buyerId]
    );
    if (rows.length) {
      return refuse('NOT_FIRST_ORDER', 'This code is for a first order only');
    }
  }

  if (campaign.maxRedemptions != null) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM promo_redemptions WHERE promo_campaign_id = $1`,
      [campaign.id]
    );
    if ((rows[0]?.c || 0) >= campaign.maxRedemptions) {
      return refuse('FULLY_REDEEMED', 'This code has been fully redeemed');
    }
  }

  if (campaign.maxRedemptionsPerIdentity != null) {
    // Count every account that shares this buyer's verified identity, not just this
    // account. Resolving the *set* of users is what makes the limit real: comparing
    // hashes directly returned nothing at all for an unverified buyer, so a
    // per-identity cap silently never fired for exactly the accounts most likely to
    // be multiplied.
    const { rows } = await pool.query(
      `WITH shared AS (
         SELECT i.user_id
           FROM user_identities i
           JOIN user_identities me ON me.user_id = $2
          WHERE (me.bvn_hash IS NOT NULL AND i.bvn_hash = me.bvn_hash)
             OR (me.nin_hash IS NOT NULL AND i.nin_hash = me.nin_hash)
       )
       SELECT count(*)::int AS c
         FROM promo_redemptions r
        WHERE r.promo_campaign_id = $1
          AND (r.buyer_id = $2 OR r.buyer_id IN (SELECT user_id FROM shared))`,
      [campaign.id, buyerId]
    );
    if ((rows[0]?.c || 0) >= campaign.maxRedemptionsPerIdentity) {
      return refuse('ALREADY_USED', 'You have already used this code');
    }
  }

  const discountKobo = promoDiscountKobo(subtotal, campaign);
  if (discountKobo <= 0) {
    return refuse('NO_DISCOUNT', 'This code gives nothing off an order this size');
  }

  const requiresTicket = promoRequiresTicket(subtotal, campaign);
  if (requiresTicket) {
    const available = await availableTicketCount(buyerId);
    if (!available) {
      return refuse('NO_TICKET', 'This order needs a ticket, and you have none available', {
        requiresTicket: true,
        ticketCount: 0,
      });
    }
    return {
      eligible: true, code: null, message: `${campaign.name} applies`,
      discountKobo, requiresTicket: true, ticketCount: available, campaign,
    };
  }

  return {
    eligible: true, code: null, message: `${campaign.name} applies`,
    discountKobo, requiresTicket: false,
    ticketCount: await availableTicketCount(buyerId), campaign,
  };
}

/**
 * Quota checks above a single order.
 *
 * The campaign's own budget, its pacing, and its per-seller cap. Separate from
 * eligibility because these are the platform's pacing decisions, and the buyer
 * should not be shown a message about the operator's budget.
 */
export async function checkCampaignBudget({ campaign, sellerId, discountKobo, commissionKobo }) {
  // Negative contribution means the order is profitable even discounted, so there
  // is nothing to fund and no reason to refuse it.
  const contribution = Math.max(0, discountKobo - commissionKobo);
  if (contribution === 0) return { ok: true, contributionKobo: 0 };

  const remaining = await campaignRemainingKobo(campaign);
  if (contribution > remaining) {
    return { ok: false, reason: 'BUDGET_EXHAUSTED', contributionKobo: contribution, remainingKobo: remaining };
  }

  if (campaign.dailyPacingKobo != null) {
    const spentToday = await campaignSpendKobo(campaign.id, {
      since: new Date(new Date().setUTCHours(0, 0, 0, 0)),
    });
    if (spentToday + contribution > campaign.dailyPacingKobo) {
      return { ok: false, reason: 'DAILY_PACING', contributionKobo: contribution, resetsIn: 'a day' };
    }
  }

  if (campaign.perSellerCapKobo != null) {
    const sellerSpent = await sellerCampaignSpendKobo(campaign.id, sellerId);
    if (sellerSpent + contribution > campaign.perSellerCapKobo) {
      return { ok: false, reason: 'SELLER_CAP', contributionKobo: contribution, resetsIn: 'a month' };
    }
  }

  return { ok: true, contributionKobo: contribution };
}

// ── Quoting and redemption ─────────────────────────────────────────────────

/**
 * Price an order with a code applied, and say whether it may proceed.
 *
 * The arithmetic always comes from `computeOrderQuote`; this decides only which
 * discount is allowed, so there is exactly one implementation of the pricing.
 */
export async function quotePromoOrder({
  buyerId,
  sellerId,
  itemsSubtotalKobo,
  shippingKobo = 0,
  code = null,
  referralAmountKobo = null,
}) {
  const tiers = await resolveTiers();

  if (!code && referralAmountKobo == null) {
    const quote = computeOrderQuote({ itemsSubtotalKobo, shippingKobo, tiers });
    return { promo: null, quote, budget: { ok: true, contributionKobo: 0 } };
  }

  let campaign = null;
  if (code) {
    campaign = await findLiveCampaignByCode(code);
    if (!campaign) {
      return {
        promo: { eligible: false, code: 'UNKNOWN_CODE', message: 'That code is not valid', discountKobo: 0 },
        quote: null,
        budget: null,
      };
    }
  }

  const evaluation = campaign
    ? await evaluateCampaign({ campaign, buyerId, sellerId, itemsSubtotalKobo })
    : null;

  if (campaign && !evaluation.eligible) {
    return { promo: evaluation, quote: null, budget: null };
  }

  // A referral reward is a flat amount rather than a percentage, so it takes the
  // same path with an explicit discount.
  let discountKobo = evaluation ? evaluation.discountKobo : Number(referralAmountKobo) || 0;

  if (!campaign && discountKobo > 0) {
    if (Number(itemsSubtotalKobo) < REFERRAL_REDEMPTION_FLOOR_KOBO) {
      return {
        promo: {
          eligible: false,
          code: 'BELOW_REDEMPTION_FLOOR',
          message: `A referral reward can be used on orders of ₦${(REFERRAL_REDEMPTION_FLOOR_KOBO / 100).toLocaleString()} or more`,
          discountKobo: 0,
        },
        quote: null,
        budget: null,
      };
    }
    if (await sharesIdentity(buyerId, sellerId)) {
      return {
        promo: { eligible: false, code: 'SELF_DEALING', message: 'That reward cannot be used on your own listing', discountKobo: 0, hardBlock: true },
        quote: null,
        budget: null,
      };
    }
    discountKobo = Math.min(discountKobo, Number(itemsSubtotalKobo));
  }

  const quote = computeOrderQuote({
    itemsSubtotalKobo,
    discountKobo,
    shippingKobo,
    tiers,
    fundingSource: campaign ? 'platform_promo' : 'platform_referral',
  });

  const budget = campaign
    ? await checkCampaignBudget({
        campaign,
        sellerId,
        discountKobo: quote.discountKobo,
        commissionKobo: quote.commissionKobo,
      })
    : { ok: true, contributionKobo: Math.max(0, quote.platformLiabilityKobo) };

  return {
    promo: {
      eligible: true,
      code: null,
      message: campaign ? `${campaign.name} applies` : 'Referral reward applies',
      discountKobo: quote.discountKobo,
      requiresTicket: evaluation?.requiresTicket || false,
      campaign,
    },
    quote,
    budget,
  };
}

/**
 * Write the ledger row and the liability for a discounted order (§6.1, §10).
 *
 * Both together because they answer different questions: the ledger row is what
 * reporting reads, the liability row is what release has to fund.
 */
export async function recordRedemption(
  clientOrNull,
  { orderId, buyerId, sellerId, quote, promo, referralId = null, referringUserId = null }
) {
  if (!quote?.isSubsidised) return null;

  const db = clientOrNull || pool;
  const contributionKobo = Math.max(0, quote.platformLiabilityKobo);
  const campaign = promo?.campaign || null;

  const { rows } = await db.query(
    `INSERT INTO promo_redemptions (
       id, order_id, buyer_id, seller_id, promo_type, code,
       promo_campaign_id, promo_code_used,
       discount_kobo, commission_kobo, platform_contribution_kobo,
       referral_id, referring_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [
      newId('pr'),
      orderId,
      buyerId,
      sellerId,
      campaign ? PROMO_TYPE_AWOOF : PROMO_TYPE_REFERRAL,
      campaign?.code || null,
      campaign?.id || null,
      campaign?.code || null,
      quote.discountKobo,
      quote.commissionKobo,
      contributionKobo,
      referralId,
      referringUserId,
    ]
  );

  await db.query(
    `INSERT INTO platform_liabilities (order_id, amount_kobo, status, funding_source)
     VALUES ($1,$2,'open',$3) ON CONFLICT (order_id) DO NOTHING`,
    [orderId, contributionKobo, quote.fundingSource]
  );

  return rows[0] || null;
}

/** Cancel a promo order's liability when it is refunded (§6.1). */
export async function cancelLiabilityForOrder(orderId, status = 'cancelled') {
  const { rows } = await pool.query(
    `UPDATE platform_liabilities SET status = $2, cancelled_at = now()
      WHERE order_id = $1 AND status = 'open'
      RETURNING order_id, amount_kobo`,
    [orderId, status]
  );
  return rows[0] || null;
}

/** Mark the liability funded, at the moment the release actually pays the seller. */
export async function markLiabilityFunded(orderId) {
  const { rows } = await pool.query(
    `UPDATE platform_liabilities SET status = 'funded', funded_at = now()
      WHERE order_id = $1 AND status = 'open'
      RETURNING order_id, amount_kobo`,
    [orderId]
  );
  return rows[0] || null;
}

export async function getOpenLiabilityTotalKobo() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS total
       FROM platform_liabilities WHERE status = 'open'`
  );
  return Number(rows[0]?.total || 0);
}

/** Spend a ticket for an order, inside the order's own transaction. */
export async function consumeTicketForOrder(client, { userId, orderId }) {
  return consumeTicket(client, { userId, orderId });
}

// ── Reporting (§10) ────────────────────────────────────────────────────────

/**
 * The subsidy lines every report must carry.
 *
 * §10 is explicit that excluding subsidised orders is wrong — the buyer genuinely
 * paid that money — and that blending them is also wrong. So they are counted, the
 * subsidy is reported separately, and it is netted against revenue.
 */
export async function getPromoReport({ since = null, until = new Date() } = {}) {
  const from = since || new Date(0);
  const { rows } = await pool.query(
    `SELECT COALESCE(c.name, 'Referral rewards') AS campaign,
            r.promo_campaign_id,
            r.promo_code_used,
            count(*)::int                                        AS orders,
            COALESCE(SUM(r.discount_kobo), 0)::bigint            AS discount_kobo,
            COALESCE(SUM(r.commission_kobo), 0)::bigint          AS commission_kobo,
            COALESCE(SUM(r.platform_contribution_kobo), 0)::bigint AS subsidy_kobo
       FROM promo_redemptions r
       LEFT JOIN promo_campaigns c ON c.id = r.promo_campaign_id
      WHERE r.created_at >= $1 AND r.created_at < $2
      GROUP BY c.name, r.promo_campaign_id, r.promo_code_used
      ORDER BY subsidy_kobo DESC`,
    [from, until]
  );

  const totals = rows.reduce(
    (acc, row) => ({
      orders: acc.orders + Number(row.orders),
      discountKobo: acc.discountKobo + Number(row.discount_kobo),
      commissionKobo: acc.commissionKobo + Number(row.commission_kobo),
      subsidyKobo: acc.subsidyKobo + Number(row.subsidy_kobo),
    }),
    { orders: 0, discountKobo: 0, commissionKobo: 0, subsidyKobo: 0 }
  );

  const unspentBudgetKobo = await totalRemainingBudgetKobo();

  return {
    byCampaign: rows,
    totals,
    unspentBudgetKobo,
    // Netting the subsidy against commission is what keeps take rate honest.
    netRevenueKobo: totals.commissionKobo - totals.subsidyKobo,
  };
}

export async function promoStatusFor(userId) {
  const tickets = await listTickets(userId);
  const live = await listLiveCampaigns();
  return {
    identityKey: tickets.identityKey,
    ticketsAvailable: tickets.available,
    tickets: tickets.tickets,
    campaigns: live.map((campaign) => ({ ...campaign, display: describeCampaign(campaign) })),
  };
}

/**
 * How a campaign should be described to a buyer.
 *
 * Computed here rather than in the app, because the app cannot infer it: a campaign
 * with a flat cap carries `discountBps: 10000` (100%) so that the cap is what binds,
 * and rendering that directly would advertise "100% off" for what is actually
 * "₦2,000 off". The modal has to say the true thing, so the truth is what leaves the
 * server.
 */
export function describeCampaign(campaign) {
  const money = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

  const headline = campaign.capFlatKobo != null
    ? `${money(campaign.capFlatKobo)} off`
    : `${campaign.discountBps / 100}% off`;

  const conditions = [];
  if (campaign.minOrderKobo > 0) conditions.push(`orders over ${money(campaign.minOrderKobo)}`);
  if (campaign.firstOrderOnly) conditions.push('first order only');
  if (campaign.requiresTicket) conditions.push('needs a deal ticket');

  const cap = campaign.capFlatKobo != null
    ? { kind: 'flat', amountKobo: campaign.capFlatKobo }
    : {
        kind: 'proportional',
        percent: campaign.capBps / 100,
        floorKobo: campaign.capFloorKobo,
        ceilingKobo: campaign.capCeilingKobo,
      };

  return {
    headline,
    cap,
    conditions,
    // One line the modal can render as-is without reassembling the rules.
    summary: [headline, ...conditions].join(' · '),
    // Never advertise a percentage when a flat cap is what actually applies.
    discountPercent: campaign.capFlatKobo != null ? null : campaign.discountBps / 100,
  };
}

// ── Payout review (§8.4) ───────────────────────────────────────────────────

/**
 * Queue a payout for a human.
 *
 * Deliberately narrow: the first promo-funded payout from a seller, or any payout
 * from a flagged account. Blanket review would punish honest sellers for the
 * behaviour of a few.
 */
export async function enqueuePayoutReview({ payoutId, sellerId, reason }) {
  const { rows } = await pool.query(
    `INSERT INTO payout_reviews (id, payout_id, seller_id, reason)
     VALUES ($1,$2,$3,$4) ON CONFLICT (payout_id) DO NOTHING RETURNING *`,
    [newId('prv'), payoutId, sellerId, str(reason) || 'manual']
  );
  return rows[0] || null;
}

/** Whether this seller has ever been paid out on a subsidised order. */
export async function isFirstPromoPayout(sellerId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM orders
      WHERE seller_id = $1 AND funding_source <> 'buyer' AND funds_released_at IS NOT NULL
      LIMIT 1`,
    [sellerId]
  );
  return rows.length === 0;
}

export async function listPendingPayoutReviews({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT r.id, r.payout_id, r.seller_id, r.reason, r.status, r.created_at,
            p.amount, p.status AS payout_status, p.currency
       FROM payout_reviews r
       JOIN payouts p ON p.id = r.payout_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC LIMIT $1`,
    [Math.min(Number(limit) || 50, 200)]
  );
  return { reviews: rows, count: rows.length };
}

export async function decidePayoutReview({ reviewId, decision, note = null, decidedBy = null }) {
  const status = str(decision) === 'approve' ? 'approved' : 'rejected';
  const { rows } = await pool.query(
    `UPDATE payout_reviews SET status = $2, note = $3, decided_by = $4, decided_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [reviewId, status, note, decidedBy]
  );
  if (!rows.length) throw httpError('That review is not pending', 404, 'review_not_found');
  return rows[0];
}

export { getSellerPayableBalance, promoCapKobo };
