-- Commission, Buyer Protection and the Awoof promo.
--
-- Implements docs/checkout-commission-promo-model.md. Everything here is additive:
-- the existing naira columns stay in place and the new kobo columns are backfilled
-- from them, so no read path breaks while the money engine moves to kobo.

-- ── Commission rate card (§3, §12) ─────────────────────────────────────────
--
-- Versioned rather than a single mutable value, with an effective date, because
-- changing a rate must not silently reprice an order that was already placed.
-- Orders store the rate they were actually charged at.

CREATE TABLE IF NOT EXISTS commission_rate_cards (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  -- [{ "upToKobo": 500000, "bps": 400 }, ...] — the final tier is open-ended.
  tiers          JSONB NOT NULL,
  note           TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two cards cannot start at the same instant, or "which rate applied" is ambiguous
-- for every order placed in that second.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_rate_cards_effective
  ON commission_rate_cards (effective_from);

CREATE INDEX IF NOT EXISTS idx_commission_rate_cards_latest
  ON commission_rate_cards (effective_from DESC);

-- ── Orders: money in kobo, and what was subsidised (§9.4, §10) ─────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS items_subtotal_kobo   BIGINT,
  ADD COLUMN IF NOT EXISTS discount_kobo         BIGINT,
  ADD COLUMN IF NOT EXISTS protection_kobo       BIGINT,
  ADD COLUMN IF NOT EXISTS commission_kobo       BIGINT,
  ADD COLUMN IF NOT EXISTS commission_bps        INT,
  ADD COLUMN IF NOT EXISTS seller_payout_kobo    BIGINT,
  ADD COLUMN IF NOT EXISTS buyer_total_kobo      BIGINT,
  ADD COLUMN IF NOT EXISTS platform_liability_kobo BIGINT,
  ADD COLUMN IF NOT EXISTS funding_source        TEXT,
  ADD COLUMN IF NOT EXISTS promo_type            TEXT,
  ADD COLUMN IF NOT EXISTS promo_code            TEXT,
  ADD COLUMN IF NOT EXISTS release_window_days   INT;

-- Existing orders predate Buyer Protection, so what the buyer paid was the item
-- price; protection is genuinely zero rather than unknown. The commission they
-- were charged is reconstructed from the rate stored on the order, falling back to
-- the flat 5% that was actually in force.
UPDATE orders
   SET items_subtotal_kobo     = COALESCE(items_subtotal_kobo, ROUND(total * 100)::bigint),
       discount_kobo           = COALESCE(discount_kobo, 0),
       protection_kobo         = COALESCE(protection_kobo, 0),
       commission_kobo         = COALESCE(
                                   commission_kobo,
                                   ROUND(total * COALESCE(commission_rate, 0.05) * 100)::bigint
                                 ),
       buyer_total_kobo        = COALESCE(buyer_total_kobo, ROUND(total * 100)::bigint),
       funding_source          = COALESCE(funding_source, 'buyer'),
       platform_liability_kobo = COALESCE(platform_liability_kobo, 0)
 WHERE items_subtotal_kobo IS NULL;

UPDATE orders
   SET seller_payout_kobo = items_subtotal_kobo - COALESCE(commission_kobo, 0)
 WHERE seller_payout_kobo IS NULL;

-- The subsidy label has to survive into every report (§10), so the queries that
-- filter on it need to be cheap.
CREATE INDEX IF NOT EXISTS idx_orders_funding_source
  ON orders (funding_source)
  WHERE funding_source IS NOT NULL AND funding_source <> 'buyer';

CREATE INDEX IF NOT EXISTS idx_orders_promo_type
  ON orders (promo_type)
  WHERE promo_type IS NOT NULL;

-- ── Platform liability per promo order (§6.1) ─────────────────────────────
--
-- One row per promo order, recording the gap between what the buyer paid and what
-- the seller is owed. Cancelled on refund, settled when the order releases.

CREATE TABLE IF NOT EXISTS platform_liabilities (
  order_id     TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  amount_kobo  BIGINT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',  -- open | funded | cancelled
  funding_source TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at    TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_liabilities_open
  ON platform_liabilities (status)
  WHERE status = 'open';

-- ── Promo contribution ledger (§5, §10, §12) ──────────────────────────────
--
-- One row per discounted order. This is the record that makes the subsidy
-- reportable, and the one the budget is measured against.

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id                      TEXT PRIMARY KEY,
  order_id                TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  buyer_id                TEXT NOT NULL REFERENCES users(id),
  seller_id               TEXT NOT NULL REFERENCES users(id),
  promo_type              TEXT NOT NULL,      -- awoof | referral
  code                    TEXT,
  discount_kobo           BIGINT NOT NULL,
  commission_kobo         BIGINT NOT NULL,
  -- discount less commission: what the platform actually spent. Negative on orders
  -- above the break-even price, where the commission more than covers the discount.
  platform_contribution_kobo BIGINT NOT NULL,
  -- Where the discount came from, so a referral reward can be traced to its chain.
  referral_id             TEXT,
  referring_user_id       TEXT REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_order
  ON promo_redemptions (order_id);

-- Budget pacing reads spend per day, and reporting reads spend per type.
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_created
  ON promo_redemptions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_type_created
  ON promo_redemptions (promo_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_buyer
  ON promo_redemptions (buyer_id, created_at DESC);

-- ── Promo tickets (§5.2, §5.3) ────────────────────────────────────────────
--
-- A ticket is what allows the top band (cap above N5,000). Entitlement is per
-- **identity**, not per account, so making another account does not reset it —
-- which is why identity_key is separate from user_id and is the BVN hash once the
-- account has verified.

CREATE TABLE IF NOT EXISTS promo_tickets (
  id            TEXT PRIMARY KEY,
  identity_key  TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id),
  source        TEXT NOT NULL,               -- baseline | referral
  status        TEXT NOT NULL DEFAULT 'available',  -- available | used | expired
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  used_at       TIMESTAMPTZ,
  order_id      TEXT REFERENCES orders(id) ON DELETE SET NULL
);

-- A baseline ticket is one per identity for life, and a referral tier is reachable
-- once, so the same grant must never be issued twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_tickets_grant_once
  ON promo_tickets (identity_key, source, COALESCE(expires_at, 'infinity'::timestamptz));

CREATE INDEX IF NOT EXISTS idx_promo_tickets_identity_available
  ON promo_tickets (identity_key)
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS idx_promo_tickets_granted
  ON promo_tickets (granted_at DESC);

-- ── Promo budget: the reserved balance (§6.3) ─────────────────────────────
--
-- The budget is real cash parked in the Paystack balance, not an accounting
-- figure, because transfers draw from that balance. Every movement is a row, so
-- drawdown is observable rather than inferred.

CREATE TABLE IF NOT EXISTS promo_budget_ledger (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,  -- reserve | topup | drawdown | refund
  amount_kobo  BIGINT NOT NULL,  -- signed: positive funds the budget, negative draws it
  order_id     TEXT REFERENCES orders(id) ON DELETE SET NULL,
  note         TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_budget_ledger_created
  ON promo_budget_ledger (created_at DESC);

-- ── Referrals (§5.5) ──────────────────────────────────────────────────────
--
-- Counted on **completed orders**, never on invites sent, and only after the
-- dispute window closes. The ladder is one-time and paid in increments, so each
-- tier is granted once ever and nobody loses a reward by passing a tier.

CREATE TABLE IF NOT EXISTS referrals (
  id                  TEXT PRIMARY KEY,
  referrer_id         TEXT NOT NULL REFERENCES users(id),
  referee_id          TEXT NOT NULL REFERENCES users(id),
  code                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | qualified | void
  qualifying_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  qualified_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A referee can only ever be referred once, by one person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referee
  ON referrals (referee_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status
  ON referrals (referrer_id, status);

-- Self-referral is a one-line fraud, so it is rejected by the database.
ALTER TABLE referrals
  DROP CONSTRAINT IF EXISTS referrals_no_self;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_no_self CHECK (referrer_id <> referee_id);

CREATE TABLE IF NOT EXISTS referral_reward_grants (
  id            TEXT PRIMARY KEY,
  referrer_id   TEXT NOT NULL REFERENCES users(id),
  tier          INT NOT NULL,               -- friends required at this milestone
  amount_kobo   BIGINT NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  redeemed_at   TIMESTAMPTZ
);

-- Increments: a tier is granted once ever, so the lifetime ceiling of N8,000 per
-- referrer falls out of the table rather than being enforced in code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_reward_grants_once
  ON referral_reward_grants (referrer_id, tier);

CREATE INDEX IF NOT EXISTS idx_referral_reward_grants_redeemable
  ON referral_reward_grants (referrer_id)
  WHERE redeemed_at IS NULL;

-- ── Identity (§8.1, §8.2, §8.3) ───────────────────────────────────────────
--
-- The unique indexes are the guardrail. "Caps keyed to BVN, not account id" only
-- holds if one BVN cannot sit on two accounts, and the cheapest way to guarantee
-- that is to make the database refuse it rather than to check in application code.

CREATE TABLE IF NOT EXISTS user_identities (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Hashes, never the raw identifiers: NDPA minimisation (spec §14.8).
  bvn_hash           TEXT,
  nin_hash           TEXT,
  bank_account_hash  TEXT,
  phone              TEXT,
  phone_verified_at  TIMESTAMPTZ,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_bvn
  ON user_identities (bvn_hash) WHERE bvn_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_nin
  ON user_identities (nin_hash) WHERE nin_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_bank_account
  ON user_identities (bank_account_hash) WHERE bank_account_hash IS NOT NULL;

-- ── Payout review (§8.4) ─────────────────────────────────────────────────
--
-- Narrow on purpose: the first promo-funded payout from a seller, or any payout
-- from a flagged account. Everything else releases on the normal schedule.

CREATE TABLE IF NOT EXISTS payout_reviews (
  id          TEXT PRIMARY KEY,
  payout_id   TEXT NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_reviews_payout
  ON payout_reviews (payout_id);

CREATE INDEX IF NOT EXISTS idx_payout_reviews_pending
  ON payout_reviews (created_at)
  WHERE status = 'pending';

-- ── Risk signals (§8.2) ──────────────────────────────────────────────────
--
-- Soft signals never block on their own: Nigerian mobile networks use
-- carrier-grade NAT and families share devices, so blocking on them would reject
-- real users. They only ever raise a review.

CREATE TABLE IF NOT EXISTS risk_signals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  order_id    TEXT REFERENCES orders(id) ON DELETE CASCADE,
  signal      TEXT NOT NULL,   -- device | ip | phone | velocity
  value_hash  TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_signals_user
  ON risk_signals (user_id, created_at DESC);
