-- Phase 1 (Firebase exit): the money tables the payments layer needs.
-- orders already carries escrow_status/commission_rate/refunds/dispute (008),
-- so this adds only what has no Neon home yet.

-- Paystack charge truth, one row per reference. Mirrors the Firestore
-- `transactions/{reference}` the Cloud Functions still write.
CREATE TABLE IF NOT EXISTS transactions (
  reference       TEXT PRIMARY KEY,
  gateway         TEXT NOT NULL DEFAULT 'paystack',
  status          TEXT,
  uid             TEXT,
  amount          NUMERIC,
  currency        TEXT NOT NULL DEFAULT 'NGN',
  channel         TEXT,
  customer_email  TEXT,
  paid_at         TIMESTAMPTZ,
  metadata        JSONB,
  gateway_event   TEXT,
  gateway_id      TEXT,
  source          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_uid
  ON transactions (uid)
  WHERE uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_email
  ON transactions (customer_email)
  WHERE customer_email IS NOT NULL;

-- Refund webhooks carry only a transaction reference, so this maps one back to
-- the order and refund entry it belongs to.
CREATE TABLE IF NOT EXISTS refund_lookups (
  payment_reference TEXT PRIMARY KEY,
  order_id          TEXT REFERENCES orders(id) ON DELETE CASCADE,
  refund_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_lookups_order
  ON refund_lookups (order_id)
  WHERE order_id IS NOT NULL;

-- Seller payouts. One row per withdrawal request, whether or not the transfer
-- reached Paystack.
CREATE TABLE IF NOT EXISTS payouts (
  id                       TEXT PRIMARY KEY,
  seller_id                TEXT NOT NULL REFERENCES users(id),
  amount                   NUMERIC NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  bank_name                TEXT,
  bank_code                TEXT,
  account_number           TEXT,
  account_name             TEXT,
  recipient_code           TEXT,
  transfer_code            TEXT,
  reference                TEXT,
  gateway_status           TEXT,
  failure_reason           TEXT,
  expected_processing_date TIMESTAMPTZ,
  requested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The double-draw guard and the balance calculation both filter on this pair.
CREATE INDEX IF NOT EXISTS idx_payouts_seller_status
  ON payouts (seller_id, status);

CREATE INDEX IF NOT EXISTS idx_payouts_seller_created
  ON payouts (seller_id, created_at DESC);

-- A transfer reference is what makes a retry idempotent at Paystack, so it must
-- not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_reference
  ON payouts (reference)
  WHERE reference IS NOT NULL AND reference <> '';

-- Transfer webhooks may arrive with only the transfer code.
CREATE INDEX IF NOT EXISTS idx_payouts_transfer_code
  ON payouts (transfer_code)
  WHERE transfer_code IS NOT NULL AND transfer_code <> '';

-- Seller bank details + the cached transfer recipient code.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_details JSONB;
