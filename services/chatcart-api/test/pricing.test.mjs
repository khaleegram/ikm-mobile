import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_COMMISSION_TIERS,
  DEFAULT_PROMO_CONFIG,
  assertQuoteInvariants,
  commissionBpsForItemKobo,
  commissionForItemKobo,
  computeOrderQuote,
  promoCapKobo,
  promoDiscountKobo,
  promoDiscountPercent,
  promoRequiresTicket,
  validateRateCard,
} from '../src/pricing.mjs';
import { paystackFeeKobo, protectionForItemKobo } from '../src/paystack.mjs';

const naira = (n) => Math.round(n * 100);
const quote = (args) => computeOrderQuote(args);

/**
 * Every figure in these tables is copied from
 * `docs/checkout-commission-promo-model.md`. If the spec changes, these fail —
 * which is the point. The arithmetic is the product.
 */

test('spec §4 — where the money goes', () => {
  const rows = [
    // item, buyerPays, protection, paystackTakes, commission, sellerGets, platformKeeps
    { item: 2500, buyerPays: 263960, protection: 13960, gateway: 13959, commission: 10000, sellerGets: 240000, keeps: 10000 },
    { item: 10000, buyerPays: 1025381, protection: 25381, gateway: 25381, commission: 35000, sellerGets: 965000, keeps: 35000 },
    { item: 50000, buyerPays: 5086295, protection: 86295, gateway: 86294, commission: 125000, sellerGets: 4875000, keeps: 125000 },
    { item: 500000, buyerPays: 50200000, protection: 200000, gateway: 200000, commission: 1000000, sellerGets: 49000000, keeps: 1000000 },
  ];

  for (const row of rows) {
    const q = quote({ itemsSubtotalKobo: naira(row.item) });
    const label = `item N${row.item}`;
    assert.equal(q.buyerTotalKobo, row.buyerPays, `${label}: buyer pays`);
    assert.equal(q.protectionKobo, row.protection, `${label}: protection`);
    assert.equal(q.gatewayFeeKobo, row.gateway, `${label}: paystack takes`);
    assert.equal(q.commissionKobo, row.commission, `${label}: commission`);
    assert.equal(q.sellerPayoutKobo, row.sellerGets, `${label}: seller gets`);

    // The spec's "platform keeps" is pure commission — it says so in §4: the rail
    // is neutral, so what the platform keeps is the commission line and nothing else.
    assert.equal(q.commissionKobo, row.keeps, `${label}: platform keeps is commission`);

    // The engine's actual net differs from pure commission by the ceiling-rounding
    // gain on the protection line, and by nothing else. Asserting the identity
    // rather than the value is what makes this a real check: the spec's tables are
    // computed unrounded, so they land up to a kobo away from what is collected.
    assert.equal(
      q.platformNetKobo,
      q.commissionKobo + (q.protectionKobo - q.gatewayFeeKobo),
      `${label}: platform net is commission plus the rounding gain`
    );
    assert.ok(
      q.protectionKobo - q.gatewayFeeKobo <= 1,
      `${label}: the rounding gain never exceeds a kobo`
    );
    assert.deepEqual(assertQuoteInvariants(q), [], `${label}: invariants`);
  }
});

test('spec §4.1 — the N2,500 boundary is keyed to the charge, not the item', () => {
  const below = quote({ itemsSubtotalKobo: naira(2462.49) });
  const at = quote({ itemsSubtotalKobo: naira(2462.5) });

  assert.equal(below.escrowHoldsKobo, naira(2499.99), 'charge just under the waiver');
  assert.equal(below.protectionKobo, naira(37.5));
  assert.equal(at.escrowHoldsKobo, naira(2601.53), 'charge just over the waiver');
  assert.equal(at.protectionKobo, naira(139.03));

  // A one-kobo price rise costs the buyer the flat fee grossed up. The spec's
  // prose rounds this to N101.52 (100 / 0.985); the real difference between the
  // two rounded protections is N101.53.
  assert.equal(at.protectionKobo - below.protectionKobo, naira(101.53));
});

test('spec §5.1 — the continuous cap, and break-even at N750,000', () => {
  // The default shape is the Awoof campaign's, so the spec's table still holds. The
  // point of the test is that the *engine* reproduces it, and that the same engine
  // reproduces a completely different campaign below.
  const cfg = DEFAULT_PROMO_CONFIG;

  const rows = [
    // item, 15% of item, cap, discount, commission, platform net cost
    { item: 2500, fifteen: 37500, cap: 200000, discount: 37500, commission: 10000, net: 27500 },
    { item: 10000, fifteen: 150000, cap: 200000, discount: 150000, commission: 35000, net: 115000 },
    { item: 20000, fifteen: 300000, cap: 200000, discount: 200000, commission: 60000, net: 140000 },
    { item: 40000, fifteen: 600000, cap: 200000, discount: 200000, commission: 120000, net: 80000 },
    { item: 100000, fifteen: 1500000, cap: 500000, discount: 500000, commission: 250000, net: 250000 },
    { item: 150000, fifteen: 2250000, cap: 750000, discount: 750000, commission: 300000, net: 450000 },
    { item: 300000, fifteen: 4500000, cap: 1500000, discount: 1500000, commission: 600000, net: 900000 },
    { item: 500000, fifteen: 7500000, cap: 1500000, discount: 1500000, commission: 1000000, net: 500000 },
    { item: 750000, fifteen: 11250000, cap: 1500000, discount: 1500000, commission: 1500000, net: 0 },
    // Above break-even the promo is profitable, so net cost goes negative.
    { item: 1000000, fifteen: 15000000, cap: 1500000, discount: 1500000, commission: 2000000, net: -500000 },
  ];

  for (const row of rows) {
    const item = naira(row.item);
    const label = `item N${row.item}`;
    assert.equal(promoCapKobo(item, cfg), row.cap, `${label}: cap`);
    assert.equal(promoDiscountKobo(item, cfg), row.discount, `${label}: discount`);

    const q = quote({
      itemsSubtotalKobo: item,
      discountKobo: row.discount,
      fundingSource: 'platform_promo',
    });
    assert.equal(q.commissionKobo, row.commission, `${label}: commission off the full price`);

    // The tabulated cost is the idealised figure, discount less commission. Check
    // the spec's own table adds up, then check the engine's real figure relates to
    // it by exactly the ceiling-rounding gain and nothing else.
    assert.equal(row.discount - row.commission, row.net, `${label}: spec net cost is discount less commission`);
    assert.equal(
      q.platformLiabilityKobo,
      row.net - (q.protectionKobo - q.gatewayFeeKobo),
      `${label}: liability is the tabulated cost less the rounding gain`
    );
    assert.deepEqual(assertQuoteInvariants(q), [], `${label}: invariants`);
  }

  // The break-even is exact: commission equals the ceiling, so the platform
  // neither funds nor profits.
  assert.equal(quote({
    itemsSubtotalKobo: naira(750000),
    discountKobo: cfg.capCeilingKobo,
  }).platformLiabilityKobo, 0);
});

test('a campaign shape is configuration, not code', () => {
  // The reason the engine takes a config at all. Same functions, four unrelated
  // offers, no branching anywhere.
  const flatN2000 = { discountBps: 10000, capFlatKobo: 200000 };
  assert.equal(promoDiscountKobo(naira(5000), flatN2000), 200000, 'flat N2,000 off N5,000');
  assert.equal(promoDiscountKobo(naira(50000), flatN2000), 200000, 'and still N2,000 off N50,000');

  const halfOff = { discountBps: 5000, capBps: 10000, capFloorKobo: 0, capCeilingKobo: 1_000_000_00 };
  assert.equal(promoDiscountKobo(naira(1000), halfOff), 50000, '50% off N1,000');
  assert.equal(promoDiscountPercent(halfOff), 50);

  const tenPercentNoCap = { discountBps: 1000, capBps: 10000, capFloorKobo: 0, capCeilingKobo: 100_000_000 };
  assert.equal(promoDiscountKobo(naira(10000), tenPercentNoCap), 100000);

  // A cap always wins over the advertised percentage, however it is expressed.
  const tiny = { discountBps: 9000, capFlatKobo: 1000 };
  assert.equal(promoDiscountKobo(naira(10000), tiny), 1000, 'the cap binds, not the 90%');

  // A campaign that gives nothing away gives nothing away.
  const none = { discountBps: 0, capBps: 0, capFloorKobo: 0, capCeilingKobo: 0 };
  assert.equal(promoDiscountKobo(naira(10000), none), 0);
});

test('a flat cap and a proportional cap are both expressible', () => {
  const proportional = { discountBps: 1500, capBps: 500, capFloorKobo: 200000, capCeilingKobo: 1500000 };
  // At N10,000 the 5% works out below the floor, so the floor is what binds — which
  // is why the spec's own table shows a N2,000 cap at both N2,500 and N10,000.
  assert.equal(promoCapKobo(naira(10000), proportional), 200000, 'the floor binds here');
  assert.equal(promoCapKobo(naira(100000), proportional), 500000, '5% of N100,000 is N5,000');
  assert.equal(promoCapKobo(naira(1000), proportional), 200000, 'the floor holds on small orders');
  assert.equal(promoCapKobo(naira(50_000_000), proportional), 1500000, 'the ceiling holds on large ones');

  const flat = { discountBps: 1500, capFlatKobo: 75000 };
  assert.equal(promoCapKobo(naira(1000), flat), 75000);
  assert.equal(promoCapKobo(naira(1_000_000), flat), 75000, 'flat means flat');
});

test('tickets are opt-in per campaign, never a hidden requirement', () => {
  // The default shape does not use tickets, so a campaign that just works is
  // usable without them.
  assert.equal(promoRequiresTicket(naira(1000000)), false, 'off by default');
  assert.equal(promoRequiresTicket(naira(1)), false);

  const ticketed = { ...DEFAULT_PROMO_CONFIG, requiresTicket: true, ticketThresholdKobo: 500000 };
  assert.equal(promoRequiresTicket(naira(99999), ticketed), false);
  assert.equal(promoRequiresTicket(naira(100000), ticketed), false, 'the cap is exactly N5,000 here');
  assert.equal(promoRequiresTicket(10_000_010, ticketed), true, 'the cap now exceeds N5,000');
  assert.equal(promoRequiresTicket(naira(1000000), ticketed), true);

  // And the threshold is the operator's, not a constant.
  const early = { ...ticketed, ticketThresholdKobo: 100 };
  assert.equal(promoRequiresTicket(naira(5000), early), true, 'a lower threshold trips sooner');
});

test('spec §3 — the rate card, band by band', () => {
  const bands = [
    [1, 400],
    [4999, 400],
    [5000, 350],
    [19999, 350],
    [20000, 300],
    [49999, 300],
    [50000, 250],
    [149999, 250],
    [150000, 200],
    [1000000, 200],
  ];
  for (const [item, bps] of bands) {
    assert.equal(commissionBpsForItemKobo(naira(item)), bps, `N${item} should charge ${bps}bps`);
  }
});

test('spec §3.1 — the bracketed cliff is real and stays documented', () => {
  // The seller pays less on the pricier item. Accepted for launch, pinned here so
  // it is a known property rather than a future surprise.
  const under = commissionForItemKobo(naira(4999));
  const over = commissionForItemKobo(naira(5000));
  assert.equal(under, naira(199.96));
  assert.equal(over, naira(175));
  assert.ok(over < under, 'revenue is non-monotonic across the band edge');
});

test('spec §9.4 — protection never falls short of the gateway fee', () => {
  // The spec asks for every item price from N1 to N3,000,000. Sweeping at naira
  // granularity covers the whole range; the boundaries below are swept at kobo
  // granularity as well, which is where an off-by-one would actually hide.
  for (let item = 1; item <= 3_000_000; item += 1) {
    const { chargeKobo, protectionKobo } = protectionForItemKobo(naira(item));
    const fee = paystackFeeKobo(chargeKobo);
    assert.ok(
      protectionKobo >= fee,
      `N${item}: protection ${protectionKobo} < fee ${fee} on charge ${chargeKobo}`
    );
    assert.equal(protectionKobo, chargeKobo - naira(item), `N${item}: charge must reconcile`);
  }
});

test('spec §9.4 — kobo-granular sweep across every regime boundary', () => {
  const boundaries = [
    2_462_50, // the flat-fee waiver turns on
    12_466_667, // the cap starts to bind
  ];
  for (const boundaryKobo of boundaries) {
    for (let delta = -2000; delta <= 2000; delta += 1) {
      const item = boundaryKobo + delta;
      if (item < 0) continue;
      const { chargeKobo, protectionKobo } = protectionForItemKobo(item);
      assert.ok(
        protectionKobo >= paystackFeeKobo(chargeKobo),
        `${item} kobo: protection ${protectionKobo} < fee`
      );
    }
  }
});

test('a quote always reconciles, at every price and every discount', () => {
  const prices = [1, 2500, 246250, 246251, 100000, 12466668, 150000, 500000, 750000, 1000000];
  for (const item of prices) {
    for (const discount of [0, 1, Math.floor(item / 3), promoDiscountKobo(item), item]) {
      const q = quote({
        itemsSubtotalKobo: item,
        discountKobo: discount,
        shippingKobo: item > 1000 ? 200000 : 0,
      });
      assert.deepEqual(assertQuoteInvariants(q), [], `item ${item}, discount ${discount}`);
      assert.ok(q.sellerPayoutKobo >= 0, 'seller never owes the platform on a sale');
      assert.ok(q.discountKobo <= q.itemsSubtotalKobo, 'discount cannot exceed the goods');
    }
  }
});

test('a discount above the item price is clamped, not honoured', () => {
  const q = quote({ itemsSubtotalKobo: naira(1000), discountKobo: naira(5000) });
  assert.equal(q.discountKobo, naira(1000));
  assert.equal(q.discountedItemsKobo, 0);
  assert.equal(q.buyerTotalKobo, 0, 'a fully discounted item costs the buyer nothing');
  assert.equal(q.sellerPayoutKobo, naira(960), 'the seller is still paid, less commission');
});

test('commission is off the seller price, never off the discounted price', () => {
  // The failure this guards against is subtle and expensive: for a promo order,
  // charging commission on the discounted amount makes the seller fund the
  // platform's own promotion.
  const q = quote({
    itemsSubtotalKobo: naira(10000),
    discountKobo: naira(1500),
    fundingSource: 'platform_promo',
  });
  assert.equal(q.commissionKobo, naira(350), '3.5% of N10,000, not of N8,500');
  assert.equal(q.sellerPayoutKobo, naira(9650), 'spec §6: the seller receives their full price less commission');
});

test('delivery fees are never commissioned and never protected', () => {
  const withoutShipping = quote({ itemsSubtotalKobo: naira(10000) });
  const withShipping = quote({ itemsSubtotalKobo: naira(10000), shippingKobo: naira(2000) });

  assert.equal(withShipping.commissionKobo, withoutShipping.commissionKobo, 'no commission on delivery');
  assert.equal(withShipping.protectionKobo, withoutShipping.protectionKobo, 'no protection on delivery');
  assert.equal(
    withShipping.sellerPayoutKobo - withoutShipping.sellerPayoutKobo,
    naira(2000),
    'delivery is passed to the seller in full'
  );

  // The gateway still charges on delivery. That cost is surfaced, not hidden.
  assert.ok(withShipping.uncoveredGatewayKobo > 0, 'the platform absorbs the rail fee on delivery');
});

test('the rate card rejects gaps, bad order and bad rates', () => {
  assert.equal(validateRateCard(DEFAULT_COMMISSION_TIERS).ok, true);

  assert.equal(validateRateCard([]).ok, false);
  assert.equal(validateRateCard([{ upToKobo: null, bps: 400 }]).ok, true, 'a single open tier is valid');
  assert.equal(
    validateRateCard([{ upToKobo: 100, bps: 400 }, { upToKobo: 100, bps: 300 }, { upToKobo: null, bps: 200 }]).ok,
    false,
    'duplicate ceiling'
  );
  assert.equal(
    validateRateCard([{ upToKobo: 500, bps: 400 }, { upToKobo: 100, bps: 300 }, { upToKobo: null, bps: 200 }]).ok,
    false,
    'out of order'
  );
  assert.equal(
    validateRateCard([{ upToKobo: 500, bps: 400 }]).ok,
    false,
    'a card must end open-ended or it cannot price the top of the market'
  );
  assert.equal(
    validateRateCard([{ upToKobo: 500, bps: 10001 }, { upToKobo: null, bps: 200 }]).ok,
    false,
    'rate above 100%'
  );
  assert.equal(
    validateRateCard([{ upToKobo: 500, bps: 400.5 }, { upToKobo: null, bps: 200 }]).ok,
    false,
    'rates are integer basis points'
  );
});

test('the cap is continuous, so no one-naira step moves real money', () => {
  // The bracketed cap this replaced moved N10,000 on a N1 price change. Assert the
  // largest possible single-naira jump stays small.
  let biggestJump = 0;
  for (let item = 1; item <= 1_000_000; item += 1) {
    const step = promoCapKobo(naira(item + 1)) - promoCapKobo(naira(item));
    biggestJump = Math.max(biggestJump, step);
  }
  // 5% of one naira is 5 kobo, plus at most a kobo of rounding.
  assert.ok(biggestJump <= 6, `largest one-naira cap jump was ${biggestJump} kobo`);
});

test('money arguments must be integer kobo', () => {
  assert.throws(() => quote({ itemsSubtotalKobo: 10.5 }), /integer number of kobo/);
  assert.throws(() => quote({ itemsSubtotalKobo: -1 }), /integer number of kobo/);
  assert.throws(() => quote({ itemsSubtotalKobo: Number.NaN }), /integer number of kobo/);
});

test('the cap floor and ceiling hold at the extremes', () => {
  const cfg = DEFAULT_PROMO_CONFIG;
  assert.equal(promoCapKobo(0, cfg), cfg.capFloorKobo, 'tiny items still get the floor');
  assert.equal(promoCapKobo(1_000_000_00, cfg), cfg.capCeilingKobo, 'huge items never exceed the ceiling');
});
