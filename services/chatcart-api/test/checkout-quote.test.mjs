import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

/**
 * Pricing a whole cart, and turning a paid charge into per-seller orders.
 *
 * The arithmetic tests run anywhere. The rest need a database and are skipped
 * without one, since they exist to prove foreign keys, transactions and the ledger —
 * which is exactly what a mock would let me lie about.
 */

const SKIP = !process.env.DATABASE_URL;

const BUYER = 'zz_cq_buyer';
const SELLER_A = 'zz_cq_seller_a';
const SELLER_B = 'zz_cq_seller_b';

const { allocateKobo, lineSubtotalKobo, quoteCheckout } = await import('../src/checkout-quote.mjs');

/** Compare money without float noise. */
function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
const promo = SKIP ? null : await import('../src/promo.mjs');
const payments = SKIP ? null : await import('../src/payments.mjs');

let pool;

// ── Allocation: the part that must never lose a kobo ───────────────────────

test('an allocation always sums back to the total', () => {
  // The failure this pins: splitting a discount by percentage and rounding each share
  // independently leaves the platform a kobo short, on every order, forever.
  const cases = [
    [1000, [1, 1, 1]],
    [1, [1, 1, 1]],
    [2, [1, 1, 1]],
    [999999, [3, 5, 7]],
    [150000, [250000, 250000, 250000]],
    [7, [1, 1, 1, 1, 1, 1, 1]],
    [0, [5, 5]],
  ];
  for (const [total, weights] of cases) {
    const parts = allocateKobo(total, weights);
    assert.equal(parts.length, weights.length);
    assert.equal(
      parts.reduce((a, b) => a + b, 0),
      total,
      `total ${total} over ${weights.length} shares`
    );
    assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0));
  }
});

test('the remainder goes to the largest share, deterministically', () => {
  // 100 over three equal weights: 33.33 each, so the extra kobo goes to the first.
  // Deterministic matters — a discount that moves between identical orders is a
  // reconciliation argument.
  assert.deepEqual(allocateKobo(100, [1, 1, 1]), [34, 33, 33]);
  // Weighted: the bigger share takes the leftover.
  assert.deepEqual(allocateKobo(10, [1, 9]), [1, 9]);
  assert.deepEqual(allocateKobo(5, [0, 5]), [0, 5]);
});

test('a degenerate split still returns the whole total', () => {
  // No weights at all, or all zero: the money must still land somewhere rather than
  // evaporating.
  assert.deepEqual(allocateKobo(500, []), []);
  assert.deepEqual(allocateKobo(500, [0, 0]), [500, 0]);
  assert.deepEqual(allocateKobo(500, [0]), [500]);
  // A negative or nonsense total is floored, not propagated.
  assert.deepEqual(allocateKobo(-50, [1, 1]), [0, 0]);
});

test('cart lines are read in both naira and kobo', () => {
  // chatcart-api carts speak naira (`price`) because the older order columns do; a
  // kobo field wins when it is a real integer so it is not rounded through a float.
  assert.equal(lineSubtotalKobo({ price: 2500, quantity: 2 }), 500000);
  assert.equal(lineSubtotalKobo({ unitPrice: 1999.99, quantity: 1 }), 199999);
  assert.equal(lineSubtotalKobo({ priceKobo: 123456, quantity: 3 }), 370368);
  assert.equal(lineSubtotalKobo({ unitPriceKobo: 100, quantity: 5 }), 500);
  // A missing quantity is one, never zero — a zero-quantity line would vanish.
  assert.equal(lineSubtotalKobo({ price: 100 }), 10000);
});

// ── The database tests ─────────────────────────────────────────────────────

async function makeUser(id) {
  await pool.query(
    `INSERT INTO users (id, email, display_name, role) VALUES ($1,$2,$3,'seller')
     ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@test.local`, id]
  );
}

async function makeCampaign(overrides = {}) {
  const code = overrides.code || `ZZCQ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return promo.createCampaign({
    code,
    name: 'Checkout test campaign',
    enabled: true,
    discountBps: 1500,
    capBps: 500,
    capFloorKobo: 200000,
    capCeilingKobo: 1500000,
    firstOrderOnly: false,
    budgetKobo: 100000000,
    ...overrides,
    code,
  });
}

function cartFor(items) {
  // Already shaped like `groupCartBySeller` output, which is what checkout passes on.
  return items.map(({ sellerId, price, quantity = 1 }) => ({
    sellerId,
    items: [{ productId: `zz_cq_${sellerId}`, name: 'Thing', price, quantity }],
    subtotal: price * quantity,
  }));
}

before(async () => {
  if (SKIP) return;
  ({ pool } = await import('../src/db.mjs'));
  await cleanup();
  await makeUser(BUYER);
  await makeUser(SELLER_A);
  await makeUser(SELLER_B);
});

after(async () => {
  if (SKIP) return;
  await cleanup();
  await pool.end();
});

async function cleanup() {
  await pool.query(`DELETE FROM promo_redemptions WHERE buyer_id LIKE 'zz_cq_%'`);
  await pool.query(`DELETE FROM platform_liabilities WHERE order_id LIKE 'zz_cq_%'`);
  await pool.query(`DELETE FROM orders WHERE customer_id LIKE 'zz_cq_%' OR idempotency_key LIKE 'zz_cq_%'`);
  await pool.query(`DELETE FROM checkout_payments WHERE buyer_id LIKE 'zz_cq_%' OR paystack_reference LIKE 'zz_cq_%'`);
  await pool.query(`DELETE FROM payment_sessions WHERE reference LIKE 'zz_cq_%'`);
  await pool.query(`DELETE FROM users WHERE id LIKE 'zz_cq_%'`);
  await pool.query(`DELETE FROM promo_budget_ledger WHERE promo_campaign_id LIKE 'pc_%'`);
  await pool.query(`DELETE FROM promo_campaigns WHERE code LIKE 'ZZCQ%'`);
}

test('a two-seller cart splits one discount exactly', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZCQSPLIT' });
  const groups = cartFor([
    { sellerId: SELLER_A, price: 10000 },
    { sellerId: SELLER_B, price: 20000 },
  ]);

  const quote = await quoteCheckout({
    buyerId: BUYER,
    groups,
    shippingKobo: 150000, // N1,500
    code: 'ZZCQSPLIT',
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.perSeller.length, 2);

  // The cap at N30,000 of goods: 5% is N1,500, which is below the N2,000 floor, so the
  // floor is what binds — before the advertised 15% would.
  assert.equal(quote.totals.discountKobo, 200000);
  const shares = quote.perSeller.map((entry) => entry.quote.discountKobo);
  assert.equal(shares.reduce((a, b) => a + b, 0), 200000, 'the shares sum to the discount');
  // Split by subtotal weight: a third and two thirds of N2,000.
  assert.deepEqual(shares, [66667, 133333]);

  // Shipping is split by the same weights and also sums exactly.
  const shippingShares = quote.perSeller.map((entry) => entry.quote.shippingKobo);
  assert.equal(shippingShares.reduce((a, b) => a + b, 0), 150000);
  assert.deepEqual(shippingShares, [50000, 100000]);

  // The buyer pays exactly the sum of the orders' protections — no more, no less.
  assert.equal(quote.totals.buyerTotalKobo, quote.display.totalKobo);
  const summed = quote.perSeller.reduce((sum, entry) => sum + entry.quote.buyerTotalKobo, 0);
  assert.equal(quote.totals.buyerTotalKobo, summed, 'one charge equals the sum of the orders');

  // The seller still gets their full price less commission: the platform funds it.
  const sellerA = quote.perSeller[0].quote;
  assert.equal(sellerA.itemsSubtotalKobo, 1000000);
  assert.equal(sellerA.commissionKobo, 35000, '3.5% off the full N10,000');
  assert.equal(sellerA.sellerPayoutKobo, 1000000 - 35000 + 50000);
  assert.ok(quote.totals.platformLiabilityKobo > 0, 'the platform is out of pocket');
});

test('an odd discount allocates without losing a kobo', { skip: SKIP }, async () => {
  // Three sellers, a discount that does not divide evenly by weight. This is where an
  // independently-rounding implementation loses a kobo.
  await makeCampaign({ code: 'ZZCQODD', capBps: 0, capFloorKobo: 1, capCeilingKobo: 10000000 });
  const groups = cartFor([
    { sellerId: 'zz_cq_s1', price: 10000 },
    { sellerId: 'zz_cq_s2', price: 0.01 },
    { sellerId: 'zz_cq_s3', price: 0.01 },
  ]);

  const quote = await quoteCheckout({ buyerId: BUYER, groups, code: 'ZZCQODD' });
  assert.equal(quote.ok, true);

  const discountShares = quote.perSeller.map((e) => e.quote.discountKobo);
  assert.equal(
    discountShares.reduce((a, b) => a + b, 0),
    quote.totals.discountKobo,
    'shares reconcile to the discount however it divides'
  );
  assert.ok(discountShares.every((s) => s >= 0));
  // No order may be given a discount bigger than its own goods.
  quote.perSeller.forEach((entry) => {
    assert.ok(entry.quote.discountKobo <= entry.quote.itemsSubtotalKobo);
  });
});

test('no code means no subsidy and no ledger', { skip: SKIP }, async () => {
  const quote = await quoteCheckout({
    buyerId: BUYER,
    groups: cartFor([{ sellerId: SELLER_A, price: 10000 }]),
  });
  assert.equal(quote.ok, true);
  assert.equal(quote.promo, null);
  assert.equal(quote.totals.discountKobo, 0);
  assert.equal(quote.perSeller[0].quote.fundingSource, 'buyer');
});

test('a cart that cannot fund its own discount is refused', { skip: SKIP }, async () => {
  // Budget smaller than one order's subsidy: the campaign cannot pay for it, so the
  // cart is refused rather than discounted and reconciled later.
  await makeCampaign({ code: 'ZZCQBROKE', budgetKobo: 1000 });
  const quote = await quoteCheckout({
    buyerId: BUYER,
    groups: cartFor([{ sellerId: SELLER_A, price: 100000 }]),
    code: 'ZZCQBROKE',
  });
  // The cart prices fine — the code is valid — but the campaign cannot fund the
  // subsidy, and checkout is what refuses to charge on that basis.
  assert.equal(quote.ok, true);
  assert.equal(quote.promo.eligible, true);
  assert.equal(quote.budget.ok, false);
  assert.equal(quote.budget.reason, 'BUDGET_EXHAUSTED');
});

test('buying your own listing is refused even in a cart', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZCQSELF' });
  const quote = await quoteCheckout({
    buyerId: SELLER_A,
    groups: cartFor([
      { sellerId: SELLER_B, price: 10000 },
      { sellerId: SELLER_A, price: 10000 },
    ]),
    code: 'ZZCQSELF',
  });
  assert.equal(quote.ok, false);
  assert.equal(quote.promo.code, 'SELF_DEALING');
});

// ── Charge → orders ────────────────────────────────────────────────────────

test('a paid promo charge becomes per-seller orders with the subsidy recorded', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZCQORDER', releaseWindowDays: 21 });
  const cartItems = [
    { id: 'zz_cq_p1', sellerId: SELLER_A, name: 'Thing', price: 10000, quantity: 1 },
    { id: 'zz_cq_p2', sellerId: SELLER_B, name: 'Other', price: 20000, quantity: 1 },
  ];

  const result = await payments.createOrdersForCharge({
    buyerId: BUYER,
    reference: 'zz_cq_ref_order',
    chargeAmount: 0, // the shortfall is logged, not fatal: the money is already captured
    cartItems,
    shippingPrice: 15,
    promoCode: 'ZZCQORDER',
    idempotencyKey: 'zz_cq_idem_order',
    buyerEmail: 'zz_cq_buyer@test.local',
    source: 'test',
  });

  assert.equal(result.created.length, 2, 'one order per seller');

  const { rows: orders } = await pool.query(
    `SELECT id, seller_id, total, shipping_price, items_subtotal_kobo, discount_kobo, protection_kobo,
            commission_kobo, seller_payout_kobo, buyer_total_kobo, platform_liability_kobo,
            funding_source, promo_code, release_window_days, escrow_status
       FROM orders WHERE checkout_payment_id = $1 ORDER BY seller_id`,
    [result.checkoutPaymentId]
  );
  assert.equal(orders.length, 2);

  const totalDiscount = orders.reduce((sum, row) => sum + Number(row.discount_kobo), 0);
  assert.equal(totalDiscount, 200000, 'the whole N2,000 discount is on the orders');

  for (const order of orders) {
    assert.equal(order.funding_source, 'platform_promo');
    assert.equal(order.promo_code, 'ZZCQORDER');
    assert.equal(order.escrow_status, 'held', 'promo money is still held, not released');
    assert.equal(order.release_window_days, 21, "the campaign's hold, not the default 7");

    // The naira total must be exactly what the buyer paid for this order, or a full
    // refund would try to return more than was ever charged.
    assert.equal(
      round2(Number(order.total)),
      round2(Number(order.buyer_total_kobo) / 100),
      'the naira total is the buyer total'
    );
    // And the buyer total is the discounted goods plus protection plus delivery.
    assert.equal(
      Number(order.items_subtotal_kobo) - Number(order.discount_kobo) + Number(order.protection_kobo),
      Number(order.buyer_total_kobo) - Number(order.shipping_price) * 100,
      'the buyer total is the discounted goods plus cover plus delivery'
    );
    assert.ok(Number(order.platform_liability_kobo) > 0, 'the platform owes the difference');
  }

  // One ledger row per discounted order, in the order transaction.
  const { rows: redemptions } = await pool.query(
    `SELECT order_id, promo_campaign_id, promo_code_used, discount_kobo, commission_kobo,
            platform_contribution_kobo
       FROM promo_redemptions WHERE buyer_id = $1`,
    [BUYER]
  );
  assert.equal(redemptions.length, 2, 'each order explains its own subsidy');
  for (const redemption of redemptions) {
    assert.ok(redemption.promo_campaign_id, 'the ledger names the campaign');
    assert.equal(redemption.promo_code_used, 'ZZCQORDER');
  }

  const { rows: liabilities } = await pool.query(
    `SELECT order_id, amount_kobo, status FROM platform_liabilities
      WHERE order_id = ANY($1::text[])`,
    [orders.map((row) => row.id)]
  );
  assert.equal(liabilities.length, 2);
  assert.ok(liabilities.every((row) => row.status === 'open'));

  // The redemption's contribution must equal the order's liability, or release funds
  // a different number than the ledger reports.
  for (const redemption of redemptions) {
    const liability = liabilities.find((row) => row.order_id === redemption.order_id);
    assert.equal(Number(liability.amount_kobo), Number(redemption.platform_contribution_kobo));
  }
});

test('creating the same charge twice does not double the subsidy', { skip: SKIP }, async () => {
  const cartItems = [
    { id: 'zz_cq_p1', sellerId: SELLER_A, name: 'Thing', price: 10000, quantity: 1 },
  ];
  const first = await payments.createOrdersForCharge({
    buyerId: BUYER,
    reference: 'zz_cq_ref_twice',
    chargeAmount: 0,
    cartItems,
    promoCode: 'ZZCQORDER',
    idempotencyKey: 'zz_cq_idem_twice',
    buyerEmail: 'zz_cq_buyer@test.local',
    source: 'test',
  });
  const second = await payments.createOrdersForCharge({
    buyerId: BUYER,
    reference: 'zz_cq_ref_twice',
    chargeAmount: 0,
    cartItems,
    promoCode: 'ZZCQORDER',
    idempotencyKey: 'zz_cq_idem_twice',
    buyerEmail: 'zz_cq_buyer@test.local',
    source: 'test',
  });

  assert.equal(second.created[0].alreadyExists, true);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM orders WHERE idempotency_key LIKE 'zz_cq_idem_twice%'`
  );
  assert.equal(rows[0].c, 1, 'one order');

  const { rows: redemptions } = await pool.query(
    `SELECT count(*)::int AS c FROM promo_redemptions WHERE order_id = $1`,
    [first.created[0].orderId]
  );
  assert.equal(redemptions[0].c, 1, 'one redemption row, so the budget is not spent twice');
});

test('a cart with no code writes no subsidy at all', { skip: SKIP }, async () => {
  const result = await payments.createOrdersForCharge({
    buyerId: BUYER,
    reference: 'zz_cq_ref_plain',
    chargeAmount: 0,
    cartItems: [{ id: 'zz_cq_p3', sellerId: SELLER_A, name: 'Thing', price: 5000, quantity: 1 }],
    idempotencyKey: 'zz_cq_idem_plain',
    buyerEmail: 'zz_cq_buyer@test.local',
    source: 'test',
  });
  const { rows } = await pool.query(
    `SELECT funding_source, discount_kobo, platform_liability_kobo, protection_kobo, buyer_total_kobo
       FROM orders WHERE id = $1`,
    [result.created[0].orderId]
  );
  assert.equal(rows[0].funding_source, 'buyer');
  assert.equal(Number(rows[0].discount_kobo), 0);
  // Negative, not zero: with no subsidy the platform earns on the order, and a
  // "liability" is the amount it owes. Nothing is recorded as owed.
  assert.ok(
    Number(rows[0].platform_liability_kobo) <= 0,
    `expected nothing owed, got ${rows[0].platform_liability_kobo}`
  );
  // Buyer protection is still charged — it is what pays for the escrow guarantee.
  assert.ok(Number(rows[0].protection_kobo) > 0);
});
