import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

/**
 * Campaign and referral behaviour that only the database can prove: unique grants,
 * foreign keys, live/disabled filtering, budget accounting and the concurrency
 * guards. Runs against DATABASE_URL and cleans up after itself under a `zz_test_`
 * prefix.
 *
 * Skipped without a database rather than failing, so a unit-only run stays green.
 */

const SKIP = !process.env.DATABASE_URL;

let pool;
const BUYER = 'zz_test_buyer_1';
const SELLER = 'zz_test_seller_1';
const REFERRER = 'zz_test_referrer_1';
const PROMO_BUYER = 'zz_test_promo_buyer';
const CAMPAIGN_BUYER = 'zz_test_campaign_buyer';
const FRIEND = (n) => `zz_test_friend_${n}`;
const CODE = 'ZZTEST';

const promo = await (SKIP ? null : import('../src/promo.mjs'));
const referrals = await (SKIP ? null : import('../src/referrals.mjs'));
const pricing = await (SKIP ? null : import('../src/pricing.mjs'));

async function makeUser(id, role = 'buyer') {
  await pool.query(
    `INSERT INTO users (id, email, display_name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@test.local`, id, role]
  );
}

async function makeOrder({ id, customerId, sellerId, totalKobo, escrow = 'held', status = 'Paid', released = false }) {
  await pool.query(
    `INSERT INTO orders (
       id, customer_id, seller_id, status, items, total, escrow_status,
       items_subtotal_kobo, commission_kobo, seller_payout_kobo, buyer_total_kobo,
       funding_source, funds_released_at, auto_release_date
     ) VALUES ($1,$2,$3,$4,'[]'::jsonb,$5,$6,$7,0,$7,$7,'buyer',$8,$9)
     ON CONFLICT (id) DO NOTHING`,
    [
      id, customerId, sellerId, status, totalKobo / 100, escrow, totalKobo,
      released ? new Date() : null,
      released ? new Date(Date.now() - 86400000) : new Date(Date.now() + 86400000 * 30),
    ]
  );
}

/** A fresh campaign each time, so tests never fight over one row. */
async function makeCampaign(overrides = {}) {
  const code = overrides.code || `${CODE}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return promo.createCampaign({
    code,
    name: 'Test campaign',
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

before(async () => {
  if (SKIP) return;
  ({ pool } = await import('../src/db.mjs'));
  await cleanup();
  await makeUser(BUYER);
  await makeUser(PROMO_BUYER);
  await makeUser(CAMPAIGN_BUYER);
  await makeUser(SELLER, 'seller');
  await makeUser(REFERRER);
});

after(async () => {
  if (SKIP) return;
  await cleanup();
  await pool.end();
});

async function cleanup() {
  await pool.query(`DELETE FROM platform_liabilities WHERE order_id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM promo_redemptions WHERE buyer_id LIKE 'zz_test_%' OR seller_id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM promo_tickets WHERE identity_key LIKE 'uid:zz_test_%'`);
  await pool.query(`DELETE FROM referral_reward_grants WHERE referrer_id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM referrals WHERE referrer_id LIKE 'zz_test_%' OR referee_id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM orders WHERE id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM user_identities WHERE user_id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM users WHERE id LIKE 'zz_test_%'`);
  await pool.query(`DELETE FROM promo_budget_ledger WHERE promo_campaign_id LIKE 'pc_%'`);
  await pool.query(`DELETE FROM promo_campaigns WHERE code LIKE 'ZZTEST%'`);
}

// ── Campaigns are configuration ────────────────────────────────────────────

test('a campaign is created, changed and switched off without a deploy', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({
    code: 'ZZTESTLIFE',
    discountBps: 1500,
    budgetKobo: 50000000,
  });

  assert.equal(campaign.enabled, true);
  assert.equal(campaign.budgetKobo, 50000000);
  assert.equal(promo.campaignStatus(campaign), 'live');

  // Change the percentage and the budget.
  const changed = await promo.updateCampaign(campaign.id, {
    discountBps: 2500,
    budgetKobo: 120000000,
  });
  assert.equal(changed.discountBps, 2500);
  assert.equal(changed.budgetKobo, 120000000);

  // The budget change is on the ledger, so the balance is explained.
  const ledger = await promo.listBudgetLedger({ campaignId: campaign.id });
  assert.ok(ledger.length >= 2, 'opening budget and the increase are both recorded');
  assert.equal(ledger[0].kind, 'topup');
  assert.equal(Number(ledger[0].amount_kobo), 70000000, 'the increase, not the new total');

  // Recorded in the order they happened, most recent first.
  assert.equal(ledger[1].kind, 'reserve');
  assert.equal(Number(ledger[1].amount_kobo), 50000000);

  // Switch it off: the code stops resolving immediately.
  const off = await promo.setCampaignEnabled(campaign.id, false);
  assert.equal(off.enabled, false);
  assert.equal(promo.campaignStatus(off), 'disabled');
  assert.equal(await promo.findLiveCampaignByCode('ZZTESTLIFE'), null, 'a disabled code is not live');
});

test('a reduced budget is recorded as a withdrawal, not a negative top-up', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZTESTREDUCE', budgetKobo: 100000000 });
  await promo.updateCampaign(campaign.id, { budgetKobo: 40000000 });

  const ledger = await promo.listBudgetLedger({ campaignId: campaign.id });
  assert.equal(ledger[0].kind, 'withdrawal');
  assert.equal(Number(ledger[0].amount_kobo), -60000000, 'signed, so the ledger sums to the balance');

  const total = ledger.reduce((sum, row) => sum + Number(row.amount_kobo), 0);
  assert.equal(total, 40000000, 'the ledger reconciles to the budget column');
});

test('a campaign cannot be scheduled in the past into a live state', { skip: SKIP }, async () => {
  const future = await makeCampaign({
    code: 'ZZTESTFUTURE',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(promo.campaignStatus(future), 'scheduled');
  assert.equal(await promo.findLiveCampaignByCode('ZZTESTFUTURE'), null, 'scheduled is not live yet');

  const past = await makeCampaign({
    code: 'ZZTESTPAST',
    endsAt: new Date(Date.now() - 86400000).toISOString(),
  });
  assert.equal(promo.campaignStatus(past), 'ended');
  assert.equal(await promo.findLiveCampaignByCode('ZZTESTPAST'), null, 'ended is not live');
});

test('a code is matched case-insensitively and spaces are ignored', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZTESTCASE' });
  for (const probe of ['zztestcase', 'ZZTESTCASE', '  zztestcase  ', 'ZzTestCase']) {
    const found = await promo.findLiveCampaignByCode(probe);
    assert.equal(found?.id, campaign.id, `"${probe}" should match`);
  }
});

test('a campaign that cannot be priced is refused with a reason', { skip: SKIP }, async () => {
  const bad = promo.validateCampaign({ code: 'x', name: '' });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.length >= 2);
  // A cap below the advertised rate can never apply, which is almost never meant.
  const futile = promo.validateCampaign({
    code: 'ZZTESTCAP',
    name: 'Futile',
    discountBps: 1000,
    capBps: 2000,
  });
  assert.equal(futile.ok, false);
  assert.match(futile.problems.join(' '), /cap could never apply/);

  // An end before a start is a typo, not a campaign.
  const backwards = promo.validateCampaign({
    code: 'ZZTESTTIME',
    name: 'Backwards',
    startsAt: '2026-02-01T00:00:00Z',
    endsAt: '2026-01-01T00:00:00Z',
  });
  assert.equal(backwards.ok, false);
  assert.match(backwards.problems.join(' '), /endsAt must be after startsAt/);

  await assert.rejects(
    () => promo.createCampaign({ code: 'ZZTESTBAD', name: 'Bad', capFloorKobo: 500000, capCeilingKobo: 100000 }),
    /cap ceiling cannot be below the cap floor/
  );
});

test('duplicate codes are refused, since one code means one campaign', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZTESTDUPE' });
  await assert.rejects(() => makeCampaign({ code: 'zztestdupe' }), /duplicate key|unique/i);
});

// ── Applying a campaign ────────────────────────────────────────────────────

test('a campaign prices an order, and the seller is untouched', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZTESTQUOTE', budgetKobo: 100000000 });

  const { promo: evaluation, quote, budget } = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER,
    sellerId: SELLER,
    itemsSubtotalKobo: 1000000,
    code: 'zztestquote',
  });

  assert.equal(evaluation.eligible, true);
  assert.equal(quote.discountKobo, 150000, '15% of N10,000');
  // Commission is off the seller's full N10,000, so the seller receives exactly
  // what they would have without the campaign — the platform funds the discount.
  assert.equal(quote.commissionKobo, 35000);
  assert.equal(quote.sellerPayoutKobo, 965000);
  assert.ok(quote.platformLiabilityKobo > 114000 && quote.platformLiabilityKobo < 115000);
  assert.equal(budget.ok, true);
  assert.deepEqual(pricing.assertQuoteInvariants(quote), []);
});

test('an unknown code says so rather than silently discounting nothing', { skip: SKIP }, async () => {
  const result = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER,
    sellerId: SELLER,
    itemsSubtotalKobo: 1000000,
    code: 'NOPE',
  });
  assert.equal(result.quote, null);
  assert.equal(result.promo.code, 'UNKNOWN_CODE');
});

test('a disabled code stops working mid-flight', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZTESTOFF' });

  const before = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTOFF',
  });
  assert.equal(before.promo.eligible, true);

  await promo.setCampaignEnabled(campaign.id, false);

  const after = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTOFF',
  });
  assert.equal(after.quote, null, 'the same code no longer applies anything');
  assert.equal(after.promo.code, 'UNKNOWN_CODE');
});

test('the minimum order value is enforced from the campaign', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZTESTMIN', minOrderKobo: 2000000 });

  const small = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTMIN',
  });
  assert.equal(small.quote, null);
  assert.equal(small.promo.code, 'BELOW_MINIMUM');

  const big = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 5000000, code: 'ZZTESTMIN',
  });
  assert.equal(big.promo.eligible, true);
});

test('first-order-only is enforced from the campaign', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZTESTFIRST', firstOrderOnly: true });
  await makeUser(FRIEND(60));

  const first = await promo.quotePromoOrder({
    buyerId: FRIEND(60), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTFIRST',
  });
  assert.equal(first.promo.eligible, true, 'a buyer with no orders qualifies');

  await makeOrder({ id: 'zz_test_order_first', customerId: FRIEND(60), sellerId: SELLER, totalKobo: 1000000 });

  const second = await promo.quotePromoOrder({
    buyerId: FRIEND(60), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTFIRST',
  });
  assert.equal(second.quote, null);
  assert.equal(second.promo.code, 'NOT_FIRST_ORDER');
});

test('buying from yourself is refused whatever the campaign says', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZTESTSELF' });
  const result = await promo.quotePromoOrder({
    buyerId: SELLER, sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTSELF',
  });
  assert.equal(result.quote, null);
  assert.equal(result.promo.code, 'SELF_DEALING');
  assert.equal(result.promo.hardBlock, true);
});

test('a flat-cap campaign behaves like a flat discount', { skip: SKIP }, async () => {
  await makeCampaign({ code: 'ZZTESTFLAT', discountBps: 10000, capFlatKobo: 200000 });

  const small = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 500000, code: 'ZZTESTFLAT',
  });
  assert.equal(small.quote.discountKobo, 200000, 'N2,000 off N5,000');

  const big = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 5000000, code: 'ZZTESTFLAT',
  });
  assert.equal(big.quote.discountKobo, 200000, 'and still N2,000 off N50,000');
});

test('a per-identity use limit is enforced', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZTESTONCE', maxRedemptionsPerIdentity: 1 });
  await makeUser(FRIEND(61));

  await makeOrder({ id: 'zz_test_order_once', customerId: FRIEND(61), sellerId: SELLER, totalKobo: 1000000 });
  const { quote } = await promo.quotePromoOrder({
    buyerId: FRIEND(61), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTONCE',
  });
  await promo.recordRedemption(null, {
    orderId: 'zz_test_order_once', buyerId: FRIEND(61), sellerId: SELLER, quote,
    promo: { campaign },
  });

  const again = await promo.quotePromoOrder({
    buyerId: FRIEND(61), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTONCE',
  });
  assert.equal(again.quote, null);
  assert.equal(again.promo.code, 'ALREADY_USED');
});

// ── Budget ────────────────────────────────────────────────────────────────

test('spending stops when the campaign budget runs out', { skip: SKIP }, async () => {
  // A budget smaller than one order's subsidy, so the first order exhausts it.
  const campaign = await makeCampaign({ code: 'ZZTESTPOOR', budgetKobo: 50000 });
  await makeUser(FRIEND(62));

  const first = await promo.quotePromoOrder({
    buyerId: FRIEND(62), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTPOOR',
  });
  assert.equal(first.promo.eligible, true);
  assert.equal(first.budget.ok, false, 'the subsidy exceeds the budget, so it is refused');
  assert.equal(first.budget.reason, 'BUDGET_EXHAUSTED');

  // Raising the budget makes the same campaign work, with no redeploy.
  await promo.updateCampaign(campaign.id, { budgetKobo: 100000000 });
  const after = await promo.quotePromoOrder({
    buyerId: FRIEND(62), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTPOOR',
  });
  assert.equal(after.budget.ok, true);
});

test('remaining budget is computed from redemptions, not a stored counter', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZTESTSPEND', budgetKobo: 100000000 });
  assert.equal(await promo.campaignRemainingKobo(campaign), 100000000);

  await makeOrder({ id: 'zz_test_order_spend', customerId: CAMPAIGN_BUYER, sellerId: SELLER, totalKobo: 1000000 });
  const { quote } = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTSPEND',
  });
  assert.ok(quote, 'the campaign applies');

  await promo.recordRedemption(null, {
    orderId: 'zz_test_order_spend', buyerId: CAMPAIGN_BUYER, sellerId: SELLER, quote,
    promo: { campaign },
  });

  const remaining = await promo.campaignRemainingKobo(campaign);
  assert.equal(remaining, 100000000 - quote.platformLiabilityKobo, 'the spend is the liability, measured');

  const { rows } = await pool.query(
    `SELECT promo_campaign_id, promo_code_used, discount_kobo, platform_contribution_kobo
       FROM promo_redemptions WHERE order_id = 'zz_test_order_spend'`
  );
  assert.equal(rows[0].promo_campaign_id, campaign.id, 'the ledger names the campaign');
  assert.equal(rows[0].promo_code_used, campaign.code);
});

test('an order that costs the platform nothing is never refused for budget', { skip: SKIP }, async () => {
  // A campaign whose discount is smaller than the commission it earns costs the
  // platform nothing, so there is nothing to fund.
  const campaign = await makeCampaign({
    code: 'ZZTESTFREE',
    discountBps: 100,
    capBps: 50,
    capFloorKobo: 0,
    capCeilingKobo: 100000,
    budgetKobo: 0,
  });

  const { quote, budget } = await promo.quotePromoOrder({
    buyerId: CAMPAIGN_BUYER, sellerId: SELLER, itemsSubtotalKobo: 100000000, code: 'ZZTESTFREE',
  });
  assert.ok(quote);
  assert.equal(budget.ok, true, 'zero budget is fine when the order funds itself');
  assert.equal(budget.contributionKobo, 0);
  assert.ok(campaign.budgetKobo === 0);
});

test('the ledger and the liability are written together', { skip: SKIP }, async () => {
  const campaign = await makeCampaign({ code: 'ZZTESTLEDGER' });

  // Quote before creating the order: the order is what makes this buyer no longer
  // a first-time buyer for a first-order-only campaign.
  const { quote } = await promo.quotePromoOrder({
    buyerId: PROMO_BUYER, sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTLEDGER',
  });
  assert.ok(quote);

  await makeOrder({ id: 'zz_test_order_promo', customerId: PROMO_BUYER, sellerId: SELLER, totalKobo: 1000000 });
  await promo.recordRedemption(null, {
    orderId: 'zz_test_order_promo', buyerId: PROMO_BUYER, sellerId: SELLER, quote,
    promo: { campaign },
  });

  const { rows } = await pool.query(
    `SELECT r.discount_kobo, r.platform_contribution_kobo, l.amount_kobo, l.status
       FROM promo_redemptions r
       JOIN platform_liabilities l ON l.order_id = r.order_id
      WHERE r.order_id = 'zz_test_order_promo'`
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].discount_kobo), 150000);
  assert.equal(Number(rows[0].amount_kobo), Number(rows[0].platform_contribution_kobo));
  assert.equal(rows[0].status, 'open');

  // Recording twice must not double the subsidy.
  await promo.recordRedemption(null, {
    orderId: 'zz_test_order_promo', buyerId: PROMO_BUYER, sellerId: SELLER, quote,
    promo: { campaign },
  });
  const { rows: after } = await pool.query(
    `SELECT count(*)::int AS c FROM promo_redemptions WHERE order_id = 'zz_test_order_promo'`
  );
  assert.equal(after[0].c, 1, 'one order, one ledger row');
});

test('a refund closes the liability but keeps the ledger row', { skip: SKIP }, async () => {
  await promo.cancelLiabilityForOrder('zz_test_order_promo');
  const { rows } = await pool.query(
    `SELECT status FROM platform_liabilities WHERE order_id = 'zz_test_order_promo'`
  );
  assert.equal(rows[0].status, 'cancelled');

  // The subsidy was still spent on the attempt, so reporting must still see it.
  const { rows: ledger } = await pool.query(
    `SELECT count(*)::int AS c FROM promo_redemptions WHERE order_id = 'zz_test_order_promo'`
  );
  assert.equal(ledger[0].c, 1);
});

test('the report names each campaign and nets the subsidy', { skip: SKIP }, async () => {
  const report = await promo.getPromoReport();
  assert.ok(report.totals.orders >= 2);
  assert.ok(report.totals.subsidyKobo > 0);
  assert.equal(report.netRevenueKobo, report.totals.commissionKobo - report.totals.subsidyKobo);
  assert.ok(report.byCampaign.some((row) => row.campaign), 'the campaign is named, not blended');
});

// ── What the buyer is told ─────────────────────────────────────────────────

test('the modal is told the truth about a flat-cap campaign', () => {
  // A flat cap carries discountBps 10000 so the cap is what binds. Rendering that
  // as a percentage would advertise "100% off", which is a lie the buyer would
  // discover at payment.
  const flat = promo.describeCampaign({
    code: 'X', discountBps: 10000, capFlatKobo: 200000, capBps: 0,
    capFloorKobo: 0, capCeilingKobo: 0, minOrderKobo: 0,
    firstOrderOnly: false, requiresTicket: false,
  });
  assert.equal(flat.headline, '₦2,000 off');
  assert.equal(flat.discountPercent, null, 'no percentage is advertised');
  assert.equal(flat.cap.kind, 'flat');
  assert.equal(flat.cap.amountKobo, 200000);

  const percent = promo.describeCampaign({
    code: 'X', discountBps: 1500, capFlatKobo: null, capBps: 500,
    capFloorKobo: 200000, capCeilingKobo: 1500000, minOrderKobo: 0,
    firstOrderOnly: false, requiresTicket: false,
  });
  assert.equal(percent.headline, '15% off');
  assert.equal(percent.discountPercent, 15);
  assert.equal(percent.cap.kind, 'proportional');
});

test('the modal is told the conditions, in the buyer\'s words', () => {
  const described = promo.describeCampaign({
    code: 'X', discountBps: 1500, capFlatKobo: null, capBps: 500,
    capFloorKobo: 200000, capCeilingKobo: 1500000,
    minOrderKobo: 2000000, firstOrderOnly: true, requiresTicket: true,
  });
  assert.equal(described.summary, '15% off · orders over ₦20,000 · first order only · needs a deal ticket');
  assert.deepEqual(described.conditions, ['orders over ₦20,000', 'first order only', 'needs a deal ticket']);
});

// ── Tickets ───────────────────────────────────────────────────────────────

test('a multi-ticket grant actually grants every ticket', { skip: SKIP }, async () => {
  // The defect this pins: keying idempotency only on (identity, source, period)
  // makes the second ticket of a two-ticket grant collide with the first and vanish
  // silently, so a "2 tickets a month" tier awards one.
  const granted = await promo.grantTickets({ userId: SELLER, source: 'zz_test_multi', quantity: 2 });
  assert.equal(granted.length, 2, 'both slots are granted');

  const again = await promo.grantTickets({ userId: SELLER, source: 'zz_test_multi', quantity: 2 });
  assert.equal(again.length, 0, 're-running the same grant is a no-op');
  assert.equal(await promo.availableTicketCount(SELLER), 2, 'no accumulation on repeat');
});

test('a ticketed campaign requires a ticket only above its threshold', { skip: SKIP }, async () => {
  await makeCampaign({
    code: 'ZZTESTTICKET',
    requiresTicket: true,
    ticketThresholdKobo: 500000,
  });
  await makeUser(FRIEND(70));
  assert.equal(await promo.availableTicketCount(FRIEND(70)), 0);

  // Below the threshold the campaign works with no ticket.
  const small = await promo.quotePromoOrder({
    buyerId: FRIEND(70), sellerId: SELLER, itemsSubtotalKobo: 1000000, code: 'ZZTESTTICKET',
  });
  assert.equal(small.promo.eligible, true);
  assert.equal(small.promo.requiresTicket, false);

  // Above it, a ticket is needed.
  const big = await promo.quotePromoOrder({
    buyerId: FRIEND(70), sellerId: SELLER, itemsSubtotalKobo: 20000000, code: 'ZZTESTTICKET',
  });
  assert.equal(big.quote, null);
  assert.equal(big.promo.code, 'NO_TICKET');

  await promo.ensureBaselineTicket(FRIEND(70));
  const allowed = await promo.quotePromoOrder({
    buyerId: FRIEND(70), sellerId: SELLER, itemsSubtotalKobo: 20000000, code: 'ZZTESTTICKET',
  });
  assert.equal(allowed.promo.eligible, true);
  assert.equal(allowed.quote.discountKobo, 1000000, 'N200,000 x 5% = the N10,000 cap');
});

// ── Referrals ─────────────────────────────────────────────────────────────

test('the referral ladder pays increments, not totals', { skip: SKIP }, async () => {
  await makeUser(FRIEND(1));
  await referrals.createReferral({ referrerId: REFERRER, refereeId: FRIEND(1) });
  await pool.query(`UPDATE referrals SET status = 'qualified' WHERE referee_id = $1`, [FRIEND(1)]);
  let granted = await referrals.grantCrossedMilestones(REFERRER);
  assert.equal(granted.length, 1);
  assert.equal(granted[0].amountKobo, 50000, 'N500 at the first friend');

  await makeUser(FRIEND(2));
  await makeUser(FRIEND(3));
  for (const id of [FRIEND(2), FRIEND(3)]) {
    await referrals.createReferral({ referrerId: REFERRER, refereeId: id });
    await pool.query(`UPDATE referrals SET status = 'qualified' WHERE referee_id = $1`, [id]);
  }
  granted = await referrals.grantCrossedMilestones(REFERRER);
  assert.equal(granted.length, 1);
  assert.equal(granted[0].amountKobo, 100000, 'N1,000 increment, not N1,500 again');
  assert.equal(granted[0].totalKobo, 150000);

  const repeat = await referrals.grantCrossedMilestones(REFERRER);
  assert.equal(repeat.length, 0, 'milestones are one-time');

  const progress = await referrals.getReferralProgress(REFERRER);
  assert.equal(progress.qualified, 3);
  assert.equal(progress.earnedKobo, 150000);
  assert.equal(progress.nextMilestone.tier, 5);
  assert.equal(progress.nextMilestone.remaining, 2);
});

test('the lifetime ceiling is N8,000 per referrer', { skip: SKIP }, async () => {
  for (let n = 4; n <= 20; n += 1) await makeUser(FRIEND(n));
  for (let n = 4; n <= 20; n += 1) {
    await referrals.createReferral({ referrerId: REFERRER, refereeId: FRIEND(n) });
    await pool.query(`UPDATE referrals SET status = 'qualified' WHERE referee_id = $1`, [FRIEND(n)]);
  }
  await referrals.grantCrossedMilestones(REFERRER);

  const progress = await referrals.getReferralProgress(REFERRER);
  assert.equal(progress.qualified, 20);
  assert.equal(progress.earnedKobo, referrals.REFERRAL_LIFETIME_MAX_KOBO);
  assert.equal(progress.earnedKobo, 800000, 'N8,000, and no more ever');
  assert.equal(progress.nextMilestone, null, 'the ladder is finished');
});

test('self-referral is refused', { skip: SKIP }, async () => {
  await assert.rejects(
    () => referrals.createReferral({ referrerId: REFERRER, refereeId: REFERRER }),
    /cannot refer yourself/
  );
});

test('a referee can only ever be referred once', { skip: SKIP }, async () => {
  await makeUser(FRIEND(50));
  const first = await referrals.createReferral({ referrerId: REFERRER, refereeId: FRIEND(50) });
  assert.equal(first.success, true);

  await makeUser(FRIEND(51));
  const second = await referrals.createReferral({ referrerId: FRIEND(51), refereeId: FRIEND(50) });
  assert.equal(second.alreadyExists, true, 'the second referrer gets nothing');
});
