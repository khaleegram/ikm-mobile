-- One Paystack charge → N seller child orders.
-- Parent checkout_payments holds the charge; orders link via checkout_payment_id
-- and share paystack_reference (unique per seller, not globally).

CREATE TABLE IF NOT EXISTS checkout_payments (
  id                    TEXT PRIMARY KEY,
  buyer_id              TEXT NOT NULL REFERENCES users(id),
  paystack_reference    TEXT NOT NULL,
  amount                NUMERIC NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'NGN',
  status                TEXT NOT NULL DEFAULT 'paid',
  cart_session_id       TEXT,
  line_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_payments_paystack_ref
  ON checkout_payments (paystack_reference)
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> '';

CREATE INDEX IF NOT EXISTS idx_checkout_payments_buyer_created
  ON checkout_payments (buyer_id, created_at DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS checkout_payment_id TEXT REFERENCES checkout_payments(id);

CREATE INDEX IF NOT EXISTS idx_orders_checkout_payment
  ON orders (checkout_payment_id)
  WHERE checkout_payment_id IS NOT NULL;

-- Allow N child orders to share one Paystack reference (one per seller).
DROP INDEX IF EXISTS idx_orders_paystack_ref;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_paystack_ref_seller
  ON orders (paystack_reference, seller_id)
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> '';

-- Idempotency is per child: ${reference}__${sellerId}
-- Keep unique on idempotency_key (values are unique per seller).
