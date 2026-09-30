import {
  computeOrderQuote,
  assertQuoteInvariants,
  promoDiscountKobo,
  promoRequiresTicket,
  DEFAULT_PROMO_CONFIG,
} from './pricing.mjs';
import {
  evaluateCampaign,
  findLiveCampaignByCode,
  availableTicketCount,
  campaignRemainingKobo,
  campaignSpendKobo,
  sellerCampaignSpendKobo,
} from './promo.mjs';
import { resolveTiers } from './commission.mjs';

/**
 * Pricing a whole checkout.
 *
 * A cart can hold several sellers' items, and one Paystack charge has to become one
 * order per seller — each with its own commission, its own escrow and its own
 * protection. So the buyer sees a single total, and everything behind it is a
 * per-seller quote.
 *
 * The rule that makes the arithmetic safe: **money is allocated, never divided.**
 * Splitting a discount or a delivery fee by percentage produces fractions, and
 * rounding N fractions independently does not sum back to the whole — which shows
 * up as a one-kobo hole in the platform's balance, per order, forever. Every split
 * here allocates integer kobo exactly and gives the remainder to the largest share.
 */

/** Largest-remainder allocation of an integer total across integer weights. */
export function allocateKobo(totalKobo, weights) {
  // Never negative: a share of a negative amount is not a thing, and propagating one
  // would put a credit where a charge belongs.
  const total = Math.max(0, Math.round(Number(totalKobo) || 0));
  const parts = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const sum = parts.reduce((acc, value) => acc + value, 0);

  if (!parts.length) return [];
  // No basis to split on: give it all to the first, so the total is still exact.
  if (sum <= 0) return parts.map((_, index) => (index === 0 ? total : 0));

  const raw = parts.map((weight) => (total * weight) / sum);
  const floors = raw.map((value) => Math.floor(value));
  let remaining = total - floors.reduce((acc, value) => acc + value, 0);

  // Hand out the leftover kobo to the largest fractional parts, biggest first.
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  for (let i = 0; i < order.length && remaining > 0; i += 1) {
    result[order[i].index] += 1;
    remaining -= 1;
  }
  return result;
}

/**
 * Kobo from a cart line.
 *
 * Carts reach here from `groupCartBySeller`, which speaks naira (`price`) because the
 * older orders columns do. Both spellings are accepted, and a kobo field wins when it
 * is genuinely an integer — so a caller that has already moved to kobo is not rounded
 * through a float on the way in.
 */
export function lineSubtotalKobo(item) {
  const quantity = Math.max(1, Math.floor(Number(item?.quantity) || 1));
  const unitKobo = Number.isInteger(item?.unitPriceKobo)
    ? item.unitPriceKobo
    : Number.isInteger(item?.priceKobo)
      ? item.priceKobo
      : Math.round(Number(item?.price ?? item?.unitPrice ?? 0) * 100);
  return unitKobo * quantity;
}

/**
 * A group's goods total in kobo.
 *
 * Prefers the subtotal the grouper already computed, because that is the figure the
 * naira columns on the order are written from — and the two must agree to the kobo or
 * the same order reads as two different prices depending on which column you look at.
 */
export function groupSubtotalKobo(group) {
  if (Number.isInteger(group?.subtotalKobo)) return group.subtotalKobo;
  if (group?.subtotal != null && Number.isFinite(Number(group.subtotal))) {
    return Math.round(Number(group.subtotal) * 100);
  }
  return (Array.isArray(group?.items) ? group.items : []).reduce(
    (sum, item) => sum + lineSubtotalKobo(item),
    0
  );
}

/**
 * What the campaign gives off this cart, or why it does not apply.
 *
 * Resolved once for the whole cart rather than per seller, because the cap is a
 * property of the offer, not of how the cart happens to be divided between
 * sellers — otherwise splitting a cart across two sellers would double the cap.
 */
export async function evaluateCartPromo({ buyerId, sellerIds = [], cartSubtotalKobo, code }) {
  const campaign = await findLiveCampaignByCode(code);
  if (!campaign) {
    return {
      eligible: false,
      code: 'UNKNOWN_CODE',
      message: 'That code is not valid',
      discountKobo: 0,
    };
  }

  // A ticket campaign's threshold is keyed to the whole cart's cap, so it is
  // checked once here.
  const requiresTicket = promoRequiresTicket(cartSubtotalKobo, campaign);

  // Self-dealing is checked against every seller in the cart: buying your own
  // listing through a promotion is the abuse the model is built to stop, and a
  // multi-seller cart is not an exception to it.
  for (const sellerId of sellerIds.filter(Boolean)) {
    const check = await evaluateCampaign({
      campaign,
      buyerId,
      sellerId,
      itemsSubtotalKobo: cartSubtotalKobo,
    });
    if (!check.eligible) {
      // A cart whose only problem is the ticket still fails here, but the ticket is
      // reported once, below, so the message is not duplicated per seller.
      if (check.code === 'NO_TICKET') continue;
      return { ...check, campaign };
    }
  }

  // Order value, first-order, per-identity and total-redemption limits come from the
  // single-campaign evaluation above; only the ticket is re-checked here because a
  // per-seller check cannot see the cart's true cap.
  if (cartSubtotalKobo < campaign.minOrderKobo) {
    return {
      eligible: false,
      code: 'BELOW_MINIMUM',
      message: `This code needs an order of ₦${(campaign.minOrderKobo / 100).toLocaleString()} or more`,
      minimumKobo: campaign.minOrderKobo,
      campaign,
    };
  }

  if (requiresTicket) {
    const available = await availableTicketCount(buyerId);
    if (!available) {
      return {
        eligible: false,
        code: 'NO_TICKET',
        message: 'This order needs a deal ticket, and you have none available',
        requiresTicket: true,
        ticketCount: 0,
        campaign,
      };
    }
  }

  const discountKobo = promoDiscountKobo(cartSubtotalKobo, campaign);
  if (discountKobo <= 0) {
    return {
      eligible: false,
      code: 'NO_DISCOUNT',
      message: 'This code gives nothing off an order this size',
      discountKobo: 0,
      campaign,
    };
  }

  return {
    eligible: true,
    code: null,
    message: `${campaign.name} applies`,
    discountKobo,
    requiresTicket,
    ticketCount: await availableTicketCount(buyerId),
    campaign,
  };
}

/**
 * Price every seller's order in a cart, with the campaign applied.
 *
 * `groups` is the cart already grouped by seller. The result is what checkout
 * charges, what each order is written with, and what the buyer's breakdown shows —
 * one object, so the three cannot disagree.
 */
export async function quoteCheckout({
  buyerId,
  groups,
  shippingKobo = 0,
  deliveryFeePaidBy = null,
  code = null,
  tiers = null,
}) {
  const cleanGroups = (Array.isArray(groups) ? groups : [])
    .map((group) => {
      const items = Array.isArray(group?.items) ? group.items : [];
      const subtotalKobo = groupSubtotalKobo(group);
      return { sellerId: String(group?.sellerId || ''), items, subtotalKobo };
    })
    .filter((group) => group.sellerId && group.subtotalKobo > 0);

  if (!cleanGroups.length) {
    const error = new Error('Invalid cart: nothing to price');
    error.statusCode = 400;
    error.code = 'CART_INVALID';
    throw error;
  }

  const rateCard = tiers || (await resolveTiers());
  const cartSubtotalKobo = cleanGroups.reduce((sum, group) => sum + group.subtotalKobo, 0);
  const shipping = Math.max(0, Math.round(Number(shippingKobo) || 0));
  // A delivery fee paid by the buyer is split by subtotal weight, so nobody's goods
  // carry someone else's courier cost.
  const weights = cleanGroups.map((group) => group.subtotalKobo);
  const shippingShares = allocateKobo(shipping, weights);

  let promo = null;
  if (code) {
    promo = await evaluateCartPromo({
      buyerId,
      sellerIds: cleanGroups.map((group) => group.sellerId),
      cartSubtotalKobo,
      code,
    });
    if (!promo.eligible) {
      return { ok: false, promo, perSeller: [], totals: null, budget: null };
    }
  }

  const discountShares = allocateKobo(promo?.discountKobo || 0, weights);
  const fundingSource = promo?.campaign ? 'platform_promo' : 'buyer';

  const perSeller = cleanGroups.map((group, index) => {
    const quote = computeOrderQuote({
      itemsSubtotalKobo: group.subtotalKobo,
      discountKobo: discountShares[index],
      shippingKobo: shippingShares[index],
      tiers: rateCard,
      fundingSource,
    });
    return { sellerId: group.sellerId, items: group.items, quote };
  });

  // Every quote must satisfy the money invariants before anything is charged. If one
  // does not, the cart is refused rather than charged at a price we cannot justify.
  for (const entry of perSeller) {
    const problems = assertQuoteInvariants(entry.quote);
    if (problems.length) {
      const error = new Error(
        `Pricing failed for seller ${entry.sellerId}: ${problems.join('; ')}`
      );
      error.statusCode = 500;
      error.code = 'QUOTE_INVARIANTS';
      throw error;
    }
  }

  const totals = perSeller.reduce(
    (acc, entry) => ({
      itemsSubtotalKobo: acc.itemsSubtotalKobo + entry.quote.itemsSubtotalKobo,
      discountKobo: acc.discountKobo + entry.quote.discountKobo,
      protectionKobo: acc.protectionKobo + entry.quote.protectionKobo,
      shippingKobo: acc.shippingKobo + entry.quote.shippingKobo,
      buyerTotalKobo: acc.buyerTotalKobo + entry.quote.buyerTotalKobo,
      commissionKobo: acc.commissionKobo + entry.quote.commissionKobo,
      sellerPayoutKobo: acc.sellerPayoutKobo + entry.quote.sellerPayoutKobo,
      gatewayFeeKobo: acc.gatewayFeeKobo + entry.quote.gatewayFeeKobo,
      platformLiabilityKobo: acc.platformLiabilityKobo + entry.quote.platformLiabilityKobo,
      escrowHoldsKobo: acc.escrowHoldsKobo + entry.quote.escrowHoldsKobo,
    }),
    {
      itemsSubtotalKobo: 0, discountKobo: 0, protectionKobo: 0, shippingKobo: 0,
      buyerTotalKobo: 0, commissionKobo: 0, sellerPayoutKobo: 0, gatewayFeeKobo: 0,
      platformLiabilityKobo: 0, escrowHoldsKobo: 0,
    }
  );

  let budget = { ok: true, contributionKobo: Math.max(0, totals.platformLiabilityKobo) };
  if (promo?.campaign) {
    // The cart's budget is checked as **one** obligation, not per seller. Checking
    // each seller's share on its own would let two orders that individually fit
    // together exceed the campaign's budget, which is the whole thing the budget
    // exists to prevent.
    const contributionKobo = Math.max(0, totals.discountKobo - totals.commissionKobo);
    const remainingKobo = await campaignRemainingKobo(promo.campaign);

    if (contributionKobo > remainingKobo) {
      budget = { ok: false, reason: 'BUDGET_EXHAUSTED', contributionKobo, remainingKobo };
    } else if (promo.campaign.dailyPacingKobo != null) {
      const spentToday = await campaignSpendKobo(promo.campaign.id, {
        since: new Date(new Date().setUTCHours(0, 0, 0, 0)),
      });
      if (spentToday + contributionKobo > promo.campaign.dailyPacingKobo) {
        budget = { ok: false, reason: 'DAILY_PACING', contributionKobo, resetsIn: 'a day' };
      }
    }

    // The per-seller cap *is* per seller, so it is checked against each one's own
    // share — with a real seller id, since the cap cannot be evaluated for "all".
    if (budget.ok && promo.campaign.perSellerCapKobo != null) {
      for (const entry of perSeller) {
        const share = Math.max(0, entry.quote.discountKobo - entry.quote.commissionKobo);
        if (share <= 0) continue;
        const sellerSpent = await sellerCampaignSpendKobo(promo.campaign.id, entry.sellerId);
        if (sellerSpent + share > promo.campaign.perSellerCapKobo) {
          budget = {
            ok: false,
            reason: 'SELLER_CAP',
            contributionKobo,
            sellerId: entry.sellerId,
            resetsIn: 'a month',
          };
          break;
        }
      }
    }
  }

  return {
    ok: true,
    promo,
    perSeller,
    totals,
    budget,
    deliveryFeePaidBy,
    // The label the buyer's breakdown shows. Protection is summed from the orders,
    // because each order is its own escrow and carries its own cover.
    display: {
      itemsKobo: totals.itemsSubtotalKobo,
      discountKobo: totals.discountKobo,
      protectionKobo: totals.protectionKobo,
      shippingKobo: totals.shippingKobo,
      totalKobo: totals.buyerTotalKobo,
      code: promo?.campaign?.code || null,
      campaignName: promo?.campaign?.name || null,
    },
  };
}

export { DEFAULT_PROMO_CONFIG };
