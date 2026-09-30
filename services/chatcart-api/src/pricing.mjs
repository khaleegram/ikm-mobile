import { config } from './config.mjs';
import { paystackFeeKobo, protectionForItemKobo } from './paystack.mjs';

/**
 * The pricing engine: commission, Buyer Protection, and the Awoof promo.
 *
 * Implements `docs/checkout-commission-promo-model.md`. Every function here is
 * pure — no database, no network — because this is the arithmetic the whole
 * marketplace is priced on and it has to be testable in isolation.
 *
 * ## Money representation
 *
 * Everything is **integer kobo**. Never a naira float, never a decimal string.
 * Rates are **basis points** (1 bp = 0.01%), so 4% is `400` and 3.5% is `350`.
 * Floats appear only inside the Paystack fee solve, where the result is
 * immediately rounded to an integer kobo.
 *
 * ## Rounding (spec §9.4)
 *
 * The two rounding rules are different on purpose:
 *
 *   - **Protection rounds up (ceiling).** It must never fall short of Paystack's
 *     real fee, because the platform would silently pay the difference on every
 *     order and never see it in testing.
 *   - **Commission and discount round half-up.** An error there moves money
 *     between the platform and the seller, which is visible and correctable.
 */

export const KOBO_PER_NAIRA = 100;
const BPS_DIVISOR = 10000;

/** Round half-up. Only for non-negative money amounts. */
function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

function requireNonNegativeIntegerKobo(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${label} must be a non-negative integer number of kobo (got ${value})`);
  }
  return n;
}

// ─── Commission rate card (spec §3) ────────────────────────────────────────

/**
 * The Balanced rate card, as shipped.
 *
 * `upToKobo` is exclusive: a tier covers everything strictly below it. The final
 * tier has no ceiling.
 *
 * This is the **fallback** used when no card is stored in the database. It is not
 * the old hardcoded 5% (spec decision 3) — this is the designed card, and it is
 * applied only when the rate-card table is empty.
 */
export const DEFAULT_COMMISSION_TIERS = Object.freeze([
  Object.freeze({ upToKobo: 500000, bps: 400 }), // item < ₦5,000      → 4%
  Object.freeze({ upToKobo: 2000000, bps: 350 }), // ₦5,000–₦19,999     → 3.5%
  Object.freeze({ upToKobo: 5000000, bps: 300 }), // ₦20,000–₦49,999    → 3%
  Object.freeze({ upToKobo: 15000000, bps: 250 }), // ₦50,000–₦149,999  → 2.5%
  Object.freeze({ upToKobo: null, bps: 200 }), // ₦150,000 and above    → 2%
]);

/** The band an item price falls in, as an index into the tier list. */
export function commissionTierIndex(itemKobo, tiers = DEFAULT_COMMISSION_TIERS) {
  const item = requireNonNegativeIntegerKobo(itemKobo, 'itemKobo');
  for (let i = 0; i < tiers.length; i += 1) {
    const ceiling = tiers[i].upToKobo;
    if (ceiling == null || item < ceiling) return i;
  }
  return tiers.length - 1;
}

/**
 * Commission rate in basis points for an item price.
 *
 * Keyed to the **item price**, not the charge — commission is never taken from the
 * fee the buyer paid for the payment rail (spec §2).
 */
export function commissionBpsForItemKobo(itemKobo, tiers = DEFAULT_COMMISSION_TIERS) {
  return tiers[commissionTierIndex(itemKobo, tiers)].bps;
}

/** Commission in kobo. Rounds half-up (spec §9.4). */
export function commissionForItemKobo(itemKobo, { bps, tiers } = {}) {
  const item = requireNonNegativeIntegerKobo(itemKobo, 'itemKobo');
  const rate = bps == null ? commissionBpsForItemKobo(item, tiers) : bps;
  return roundHalfUp((item * rate) / BPS_DIVISOR);
}

/**
 * Check a rate card before it is stored.
 *
 * A card with a gap or an out-of-order ceiling would price some items at the wrong
 * band, so this rejects rather than repairs.
 */
export function validateRateCard(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { ok: false, message: 'A rate card needs at least one tier' };
  }

  let previousCeiling = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    const isLast = i === tiers.length - 1;

    if (!Number.isInteger(tier?.bps) || tier.bps < 0 || tier.bps > BPS_DIVISOR) {
      return { ok: false, message: `Tier ${i + 1}: rate must be 0–10000 basis points` };
    }

    if (isLast) {
      if (tier.upToKobo != null) {
        return { ok: false, message: 'The final tier must be open-ended (upToKobo: null)' };
      }
      break;
    }

    if (!Number.isInteger(tier.upToKobo) || tier.upToKobo <= previousCeiling) {
      return {
        ok: false,
        message: `Tier ${i + 1}: ceiling must be an integer kobo above the previous tier's`,
      };
    }
    previousCeiling = tier.upToKobo;
  }

  return { ok: true };
}

// ─── Buyer Protection (spec §2) ────────────────────────────────────────────

/**
 * Protection for a discounted item total, in kobo.
 *
 * Protection is a function of the **charge**, which is why it is keyed to the
 * post-discount amount — that is what makes it equal Paystack's fee (spec decision
 * 4). Delivery fees are excluded (decision 1).
 *
 * Returns `{ chargeKobo, protectionKobo }` where `chargeKobo` is the total the
 * buyer pays for the goods, protection included.
 */
export function protectionForDiscountedItemsKobo(discountedItemsKobo) {
  const items = requireNonNegativeIntegerKobo(discountedItemsKobo, 'discountedItemsKobo');
  return protectionForItemKobo(items);
}

// ─── Promo campaigns (configurable, not hardcoded) ─────────────────────────

/**
 * The shape of a discount campaign.
 *
 * Every number here is an operator's decision that lives in a database row, not a
 * constant in this file. That was the first version's mistake: it baked one
 * campaign's marketing choices (15% off, a 5% cap, a ₦15,000 ceiling) into the
 * product, so nobody could run a different one without a deploy.
 *
 * This object is the *default shape* used when a campaign does not override a
 * field, and the documented meaning of each field. Nothing reads it unless a caller
 * asks for a default.
 */
export const DEFAULT_PROMO_CONFIG = Object.freeze({
  discountBps: 1500, // 15% off
  capBps: 500, // capped at 5% of the item...
  capFloorKobo: 200000, // ...with a ₦2,000 floor...
  capCeilingKobo: 1500000, // ...and a ₦15,000 ceiling
  capFlatKobo: null, // set this instead to use a flat cap
  firstOrderOnly: true,
  minOrderKobo: 0,
  requiresTicket: false,
  ticketThresholdKobo: 500000,
  budgetKobo: 0,
  releaseWindowDays: 7,
});

/**
 * The cap for a campaign at a given item price, in kobo.
 *
 * Two shapes are supported because two are genuinely useful: a proportional cap
 * (`capBps` of the item, clamped between a floor and a ceiling) which is the
 * continuous form in spec §5.1, and a flat cap (`capFlatKobo`) for a campaign that
 * just wants "₦2,000 off, whatever the item costs".
 *
 * Continuous, not bracketed — a bracketed cap makes a one-naira price change move
 * thousands, which sellers then price around.
 */
export function promoCapKobo(itemKobo, config = DEFAULT_PROMO_CONFIG) {
  const item = requireNonNegativeIntegerKobo(itemKobo, 'itemKobo');
  const cfg = { ...DEFAULT_PROMO_CONFIG, ...config };

  if (cfg.capFlatKobo != null) return Math.max(0, Math.round(cfg.capFlatKobo));

  const proportional = roundHalfUp((item * cfg.capBps) / BPS_DIVISOR);
  const raised = Math.max(cfg.capFloorKobo, proportional);
  return Math.min(cfg.capCeilingKobo, raised);
}

/**
 * What the campaign actually takes off, given the item price.
 *
 * Always the smaller of the advertised percentage and the cap, so a campaign can
 * never give away more than its cap allows however the percentage is set.
 */
export function promoDiscountKobo(itemKobo, config = DEFAULT_PROMO_CONFIG) {
  const item = requireNonNegativeIntegerKobo(itemKobo, 'itemKobo');
  const cfg = { ...DEFAULT_PROMO_CONFIG, ...config };
  const advertised = roundHalfUp((item * cfg.discountBps) / BPS_DIVISOR);
  return Math.min(advertised, promoCapKobo(item, cfg));
}

/**
 * Whether this campaign needs a ticket at this price.
 *
 * A campaign can run its scarcity mechanic or not. `requiresTicket` is off in the
 * default shape, because a campaign that simply works should not need a ticket to
 * be usable.
 */
export function promoRequiresTicket(itemKobo, config = DEFAULT_PROMO_CONFIG) {
  const cfg = { ...DEFAULT_PROMO_CONFIG, ...config };
  if (!cfg.requiresTicket) return false;
  return promoCapKobo(itemKobo, cfg) > cfg.ticketThresholdKobo;
}

/** Advertised as a percentage, for admin screens and the checkout modal. */
export function promoDiscountPercent(config = DEFAULT_PROMO_CONFIG) {
  return ({ ...DEFAULT_PROMO_CONFIG, ...config }.discountBps) / 100;
}

// ─── The order quote ───────────────────────────────────────────────────────

/**
 * Price one seller's order, end to end.
 *
 * This is the single place the marketplace decides what a buyer pays, what the
 * seller receives, and what the platform earns or subsidises. Checkout, escrow,
 * release and refunds all read the numbers this produces rather than recomputing
 * them, so a rate change can never make an old order settle at a new price.
 *
 * The one asymmetry to hold on to: **commission comes off the seller's full
 * price, the discount comes off what the buyer pays.** A promo order therefore
 * has the platform paying the difference. Getting this backwards would quietly
 * make sellers fund the platform's own promotion.
 *
 * @param itemsSubtotalKobo  The seller's price for the goods, before any discount.
 * @param discountKobo       Platform-funded discount (Awoof or referral reward).
 * @param shippingKobo       Delivery. Never commissioned and never protected
 *                           (spec decision 1), so the platform absorbs the
 *                           gateway fee on it rather than hiding it.
 * @param bps                Commission override; omit to use the rate card.
 * @param tiers              Rate card override; omit to use the default card.
 * @param fundingSource      'buyer' | 'platform_promo' | 'platform_referral'.
 */
export function computeOrderQuote({
  itemsSubtotalKobo,
  discountKobo = 0,
  shippingKobo = 0,
  bps = null,
  tiers = DEFAULT_COMMISSION_TIERS,
  fundingSource = 'buyer',
}) {
  const subtotal = requireNonNegativeIntegerKobo(itemsSubtotalKobo, 'itemsSubtotalKobo');
  const requestedDiscount = requireNonNegativeIntegerKobo(discountKobo, 'discountKobo');
  const shipping = requireNonNegativeIntegerKobo(shippingKobo, 'shippingKobo');

  // A discount can never exceed the goods. It comes out of the item price, not
  // out of delivery, and it cannot make an order negative.
  const discount = Math.min(requestedDiscount, subtotal);
  const discountedItems = subtotal - discount;

  // Commission is keyed to the seller's own price, so a promotion never changes
  // what the seller is charged (spec §5.1, §6).
  const commissionKobo = commissionForItemKobo(subtotal, { bps, tiers });
  const commissionBps = bps == null ? commissionBpsForItemKobo(subtotal, tiers) : bps;

  // Protection is keyed to the discounted amount, because it is a function of the
  // charge and the charge is what the buyer actually pays (spec decision 4).
  const { protectionKobo } = protectionForDiscountedItemsKobo(discountedItems);

  const escrowHoldsKobo = discountedItems + protectionKobo;
  const buyerTotalKobo = escrowHoldsKobo + shipping;

  // The gateway charges on everything, delivery included.
  const gatewayFeeKobo = paystackFeeKobo(buyerTotalKobo);
  const landsInPlatformBalanceKobo = buyerTotalKobo - gatewayFeeKobo;

  // Delivery is passed to the seller in full; they are the one paying the courier.
  const sellerPayoutKobo = subtotal - commissionKobo + shipping;

  // The gap the platform must fund at release (spec §6.1). Negative means the
  // order is profitable — which is why the promo table has a break-even price.
  const platformLiabilityKobo = sellerPayoutKobo - landsInPlatformBalanceKobo;

  return {
    // pricing inputs, echoed so a stored order can be re-derived exactly
    itemsSubtotalKobo: subtotal,
    discountKobo: discount,
    shippingKobo: shipping,
    commissionBps,
    fundingSource,

    // checkout lines
    discountedItemsKobo: discountedItems,
    protectionKobo,
    buyerTotalKobo,

    // who gets what
    commissionKobo,
    sellerPayoutKobo,
    escrowHoldsKobo,
    gatewayFeeKobo,
    landsInPlatformBalanceKobo,
    platformLiabilityKobo,

    // What the buyer's protection line does not cover. Non-zero only when there is
    // a delivery fee, since protection is deliberately not charged on it.
    uncoveredGatewayKobo: Math.max(0, gatewayFeeKobo - protectionKobo),

    // The platform's own margin: commission less everything it had to fund. This
    // is the figure spec §5.1 tabulates as "platform net cost", sign-flipped.
    platformNetKobo: -platformLiabilityKobo,

    isSubsidised: discount > 0,
  };
}

/**
 * Guardrails that must hold for every quote.
 *
 * Exposed so checkout can refuse an order rather than accept one the platform
 * cannot fund, and so tests can assert the invariants over a price sweep.
 */
export function assertQuoteInvariants(quote) {
  const problems = [];

  // Protection must cover Paystack's real fee on the goods. Rounding down here is
  // the invisible leak spec §9.4 warns about.
  if (quote.protectionKobo + quote.uncoveredGatewayKobo < quote.gatewayFeeKobo) {
    problems.push(
      `protection ${quote.protectionKobo} plus uncovered ${quote.uncoveredGatewayKobo} ` +
        `is below the gateway fee ${quote.gatewayFeeKobo}`
    );
  }

  if (quote.discountedItemsKobo + quote.protectionKobo !== quote.escrowHoldsKobo) {
    problems.push('protection and discounted items do not reconcile to what escrow holds');
  }

  if (quote.escrowHoldsKobo + quote.shippingKobo !== quote.buyerTotalKobo) {
    problems.push('escrow and delivery do not reconcile to what the buyer pays');
  }

  // Commission is off the seller's full price, not the discounted one.
  if (quote.sellerPayoutKobo + quote.commissionKobo !== quote.itemsSubtotalKobo + quote.shippingKobo) {
    problems.push('seller payout and commission do not reconcile to the item total');
  }

  if (quote.discountKobo > quote.itemsSubtotalKobo) {
    problems.push('discount exceeds the item subtotal');
  }

  if (quote.sellerPayoutKobo < 0) {
    problems.push('seller payout is negative');
  }

  if (quote.platformLiabilityKobo !== quote.sellerPayoutKobo - quote.landsInPlatformBalanceKobo) {
    problems.push('platform liability does not reconcile to seller payout less the platform balance');
  }

  return problems;
}
