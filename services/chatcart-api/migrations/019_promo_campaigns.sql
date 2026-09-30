-- Promo campaigns become configuration, not constants.
--
-- The engine originally hardcoded Awoof's shape (15% off, capped at 5% of the item,
-- N2,000 floor, N15,000 ceiling, N5,000 ticket threshold). That made one operator's
-- marketing decision into the product's behaviour. A campaign is now a row an admin
-- owns: its code, its percentage, its cap, its budget, and whether it is on.
--
-- Nothing about the shape is decided in code any more. Raising the budget, changing
-- the percentage, ending a campaign or switching it off is an update to one row —
-- no deploy, and checkout follows it immediately.

CREATE TABLE IF NOT EXISTS promo_campaigns (
  id            TEXT PRIMARY KEY,
  -- The code a buyer types. Case-insensitive uniqueness, since nobody types case.
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  archived_at   TIMESTAMPTZ,

  -- Discount shape. All rates in basis points; all money in integer kobo.
  discount_bps       INT  NOT NULL DEFAULT 1500,     -- 15%
  cap_bps            INT  NOT NULL DEFAULT 500,      -- cap = 5% of the item...
  cap_floor_kobo     BIGINT NOT NULL DEFAULT 200000, -- ...with a N2,000 floor...
  cap_ceiling_kobo   BIGINT NOT NULL DEFAULT 1500000,-- ...and a N15,000 ceiling
  -- An absolute ceiling in naira, for a campaign that wants a flat cap instead of
  -- a proportional one. Null means use cap_bps.
  cap_flat_kobo      BIGINT,

  -- Who it applies to.
  first_order_only   BOOLEAN NOT NULL DEFAULT true,
  min_order_kobo     BIGINT NOT NULL DEFAULT 0,
  -- Optional scarcity mechanic. Off by default, because a campaign that just works
  -- should not need tickets to be usable.
  requires_ticket          BOOLEAN NOT NULL DEFAULT false,
  ticket_threshold_kobo    BIGINT NOT NULL DEFAULT 500000,
  max_redemptions          INT,
  max_redemptions_per_identity INT,

  -- Budget. This is the number an operator raises or lowers; it is not derived.
  budget_kobo   BIGINT NOT NULL DEFAULT 0,
  -- What one order may draw. Null means uncapped beyond the budget.
  daily_pacing_kobo   BIGINT,
  per_seller_cap_kobo BIGINT,

  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Codes are matched case-insensitively, so uniqueness must be too, or "AWOOF" and
-- "awoof" become two campaigns with one intended meaning.
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_campaigns_code_lower
  ON promo_campaigns (lower(code));

CREATE INDEX IF NOT EXISTS idx_promo_campaigns_live
  ON promo_campaigns (enabled)
  WHERE enabled = true AND archived_at IS NULL;

ALTER TABLE promo_campaigns
  DROP CONSTRAINT IF EXISTS promo_campaigns_shape;
ALTER TABLE promo_campaigns
  ADD CONSTRAINT promo_campaigns_shape CHECK (
    discount_bps BETWEEN 0 AND 10000
    AND cap_bps BETWEEN 0 AND 10000
    AND cap_floor_kobo >= 0
    AND cap_ceiling_kobo >= cap_floor_kobo
    AND budget_kobo >= 0
    AND (cap_flat_kobo IS NULL OR cap_flat_kobo >= 0)
    AND (max_redemptions IS NULL OR max_redemptions > 0)
    AND (max_redemptions_per_identity IS NULL OR max_redemptions_per_identity > 0)
    AND (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
  );

-- ── Redemptions point at the campaign that granted them ────────────────────
--
-- Without this, a report cannot say which campaign spent the budget, and a
-- campaign that is switched off cannot be distinguished from one that was never
-- used.

ALTER TABLE promo_redemptions
  ADD COLUMN IF NOT EXISTS promo_campaign_id TEXT REFERENCES promo_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code_used TEXT;

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_campaign
  ON promo_redemptions (promo_campaign_id, created_at DESC);

-- ── The budget audit trail keeps the campaign with each movement ────────────

ALTER TABLE promo_budget_ledger
  ADD COLUMN IF NOT EXISTS promo_campaign_id TEXT REFERENCES promo_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promo_budget_ledger_campaign
  ON promo_budget_ledger (promo_campaign_id, created_at DESC);

-- ── The refund rule needs the release window on the campaign ───────────────
--
-- A campaign can hold funds longer than the normal path, but the length is the
-- operator's choice, not a constant baked into the code.

ALTER TABLE promo_campaigns
  ADD COLUMN IF NOT EXISTS release_window_days INT NOT NULL DEFAULT 7;

ALTER TABLE promo_campaigns
  DROP CONSTRAINT IF EXISTS promo_campaigns_release_window;
ALTER TABLE promo_campaigns
  ADD CONSTRAINT promo_campaigns_release_window CHECK (release_window_days BETWEEN 0 AND 90);

-- ── Seed: the Awoof shape as a default, switched off ───────────────────────
--
-- Seeded disabled on purpose. The engine now does nothing until an operator turns a
-- campaign on, which is the whole point: the subsidy is a decision, not a default.

INSERT INTO promo_campaigns (
  id, code, name, description, enabled,
  discount_bps, cap_bps, cap_floor_kobo, cap_ceiling_kobo,
  first_order_only, min_order_kobo, requires_ticket, ticket_threshold_kobo,
  budget_kobo, release_window_days
) VALUES (
  'pc_awoof_default', 'AWOOF', 'Awoof deal',
  'Seeded example. Disabled until switched on.',
  false,
  1500, 500, 200000, 1500000,
  true, 0, false, 500000,
  0, 7
) ON CONFLICT (id) DO NOTHING;
