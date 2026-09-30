import { randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import { DEFAULT_COMMISSION_TIERS, validateRateCard } from './pricing.mjs';

/**
 * The commission rate card, versioned by effective date (spec §3, §12).
 *
 * A single mutable rate would reprice history: change 4% to 3% and every report
 * about last month becomes wrong. So a card is immutable once it takes effect, and
 * a change is a new card with a new `effective_from`. Orders store the rate they
 * were actually charged at, so an old order settles at an old price even after the
 * card moves.
 *
 * The built-in Balanced card is the fallback when no card has been stored. That is
 * not the old hardcoded 5% — spec decision 3 removed that specifically so a
 * missing rate fails rather than silently billing a guess.
 */

const CACHE_TTL_MS = 60_000;

let cached = null;
let cachedAt = 0;

export function invalidateRateCardCache() {
  cached = null;
  cachedAt = 0;
}

function newCardId() {
  return `rc_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

/**
 * The card in force at a moment, with its tiers.
 *
 * Cached briefly because it is read on every checkout and changes at most a few
 * times a year. The cache is cleared whenever a card is created, so a new rate
 * applies immediately rather than up to a minute later.
 */
export async function resolveRateCard(at = new Date()) {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  const { rows } = await pool.query(
    `SELECT id, name, effective_from, tiers
       FROM commission_rate_cards
      WHERE effective_from <= $1
      ORDER BY effective_from DESC
      LIMIT 1`,
    [at]
  );

  if (rows.length) {
    const tiers = Array.isArray(rows[0].tiers) ? rows[0].tiers : [];
    const check = validateRateCard(tiers);
    if (check.ok) {
      cached = {
        id: rows[0].id,
        name: rows[0].name,
        effectiveFrom: rows[0].effective_from,
        tiers,
        isDefault: false,
      };
      cachedAt = Date.now();
      return cached;
    }
    // A stored card that cannot price the whole market is worse than the default:
    // it would silently mis-band the items that fall outside it.
    console.error(
      `Rate card ${rows[0].id} is invalid (${check.message}); falling back to the built-in card`
    );
  }

  cached = {
    id: 'builtin_balanced',
    name: 'Balanced (built-in)',
    effectiveFrom: null,
    tiers: DEFAULT_COMMISSION_TIERS,
    isDefault: true,
  };
  cachedAt = Date.now();
  return cached;
}

/** Just the tiers, for passing into `computeOrderQuote`. */
export async function resolveTiers(at = new Date()) {
  return (await resolveRateCard(at)).tiers;
}

/** The rate, in basis points, that an item at this price would be charged. */
export async function rateBpsForItem(itemKobo, at = new Date()) {
  const { tiers } = await resolveRateCard(at);
  const { commissionBpsForItemKobo } = await import('./pricing.mjs');
  return commissionBpsForItemKobo(itemKobo, tiers);
}

export async function listRateCards() {
  const { rows } = await pool.query(
    `SELECT id, name, effective_from, tiers, note, created_by, created_at
       FROM commission_rate_cards
      ORDER BY effective_from DESC`
  );
  return rows;
}

/**
 * Add a rate card.
 *
 * Scheduling into the past is refused: it would reprice orders already placed,
 * which is the exact failure the versioning exists to prevent.
 */
export async function createRateCard({ tiers, name, effectiveFrom, note = null, createdBy = null }) {
  const check = validateRateCard(tiers);
  if (!check.ok) {
    const error = new Error(check.message);
    error.statusCode = 400;
    throw error;
  }

  const when = effectiveFrom ? new Date(effectiveFrom) : new Date();
  if (Number.isNaN(when.getTime())) {
    const error = new Error('effectiveFrom is not a valid date');
    error.statusCode = 400;
    throw error;
  }

  if (when.getTime() < Date.now() - 60_000) {
    const error = new Error(
      'A rate card cannot take effect in the past — that would reprice orders already placed'
    );
    error.statusCode = 400;
    throw error;
  }

  const id = newCardId();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise card creation so two admins cannot land on the same instant and
    // make "which rate applied" ambiguous.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['commission_rate_card']);
    const { rows } = await client.query(
      `INSERT INTO commission_rate_cards (id, name, effective_from, tiers, note, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)
       RETURNING *`,
      [id, name || 'Untitled card', when.toISOString(), JSON.stringify(tiers), note, createdBy]
    );
    await client.query('COMMIT');
    invalidateRateCardCache();
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      const conflict = new Error('Another rate card already takes effect at that exact time');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  } finally {
    client.release();
  }
}
