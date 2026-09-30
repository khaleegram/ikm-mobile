import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STANDARD_RELEASE_WINDOW_DAYS,
  autoReleaseDateFor,
  releaseWindowDaysFor,
} from '../src/promo.mjs';
import { DEFAULT_PROMO_CONFIG } from '../src/pricing.mjs';
import { REFERRAL_LADDER, REFERRAL_LIFETIME_MAX_KOBO } from '../src/referrals.mjs';

/**
 * Rules that are pure arithmetic or constants. No database, so these run anywhere.
 */

test('spec §7.1 — a promo order is held longer than a normal one', () => {
  assert.equal(releaseWindowDaysFor('buyer'), STANDARD_RELEASE_WINDOW_DAYS);
  assert.equal(releaseWindowDaysFor('platform_promo'), DEFAULT_PROMO_CONFIG.releaseWindowDays);
  assert.equal(releaseWindowDaysFor('platform_referral'), DEFAULT_PROMO_CONFIG.releaseWindowDays);
  assert.ok(
    DEFAULT_PROMO_CONFIG.releaseWindowDays > STANDARD_RELEASE_WINDOW_DAYS,
    'the longer hold is the rate limiter on cycling subsidy'
  );
});

test('the release window is the campaign\'s choice, not a constant', () => {
  // An operator can hold a risky campaign longer, or run a trusted one shorter,
  // without touching code.
  assert.equal(releaseWindowDaysFor({ releaseWindowDays: 30 }), 30);
  assert.equal(releaseWindowDaysFor({ releaseWindowDays: 0 }), 0, '0 means release as normal');
  // A campaign that does not specify one falls back rather than throwing.
  assert.equal(releaseWindowDaysFor({}), DEFAULT_PROMO_CONFIG.releaseWindowDays);
});

test('the release date follows the funding source, not the price', () => {
  const sentAt = new Date('2026-01-01T00:00:00Z');

  const normal = autoReleaseDateFor({ sentAt, fundingSourceOrCampaign: 'buyer' });
  assert.equal(normal.toISOString(), '2026-01-03T00:00:00.000Z');

  const promo = autoReleaseDateFor({ sentAt, fundingSourceOrCampaign: 'platform_promo' });
  assert.equal(promo.toISOString(), '2026-01-08T00:00:00.000Z');

  // A referral reward is platform money too, so it waits the same window.
  const referral = autoReleaseDateFor({ sentAt, fundingSourceOrCampaign: 'platform_referral' });
  assert.equal(referral.toISOString(), promo.toISOString());

  // A campaign with its own window uses it, so the hold is the operator's choice.
  const slow = autoReleaseDateFor({ sentAt, fundingSourceOrCampaign: { releaseWindowDays: 21 } });
  assert.equal(slow.toISOString(), '2026-01-22T00:00:00.000Z');

  // Never mutates the input.
  assert.equal(sentAt.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('spec §5.5 — the referral ladder adds up to exactly N8,000', () => {
  // The increments are the promise; the totals are the headline. They have to
  // agree, because the totals are what the user is told.
  assert.deepEqual(
    REFERRAL_LADDER.map((step) => step.tier),
    [1, 3, 5, 10, 20]
  );

  let running = 0;
  for (const step of REFERRAL_LADDER) {
    running += step.incrementKobo;
    assert.equal(running, step.totalKobo, `tier ${step.tier}: running total must match the headline`);
  }

  assert.equal(REFERRAL_LIFETIME_MAX_KOBO, 800000, 'N8,000 per referrer, ever');
});

test('spec §5.5 — only the top tiers recur, and higher tiers supersede lower ones', () => {
  // Ticket grants are one-time for tier 5 and monthly above it. A recurring grant
  // is the only unbounded exposure, so it should exist only where the spec says.
  const oneTime = REFERRAL_LADDER.filter((step) => step.oneTimeTickets > 0);
  const monthly = REFERRAL_LADDER.filter((step) => step.monthlyTickets > 0);

  assert.deepEqual(oneTime.map((step) => step.tier), [5]);
  assert.deepEqual(monthly.map((step) => step.tier), [10, 20]);
  assert.ok(
    REFERRAL_LADDER.every((step) => !(step.oneTimeTickets > 0 && step.monthlyTickets > 0)),
    'no tier grants both a one-time and a recurring ticket'
  );

  // Monthly entitlement is the best reached tier's, not a sum: twenty friends means
  // five a month, not seven.
  const best = REFERRAL_LADDER.reduce(
    (acc, step) => (20 >= step.tier ? Math.max(acc, step.monthlyTickets) : acc),
    0
  );
  assert.equal(best, 5);
});
