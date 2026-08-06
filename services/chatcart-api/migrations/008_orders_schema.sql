-- Market orders dual-run (Phase A): Postgres mirror of Firestore orders
-- Firestore remains authoritative for writes until Phase B.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS purchase_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_buyer_id TEXT;

CREATE TABLE IF NOT EXISTS orders (
  id                    TEXT PRIMARY KEY,
  customer_id           TEXT NOT NULL REFERENCES users(id),
  seller_id             TEXT NOT NULL REFERENCES users(id),
  post_id               TEXT,
  idempotency_key       TEXT,
  status                TEXT NOT NULL,
  items                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  total                 NUMERIC NOT NULL DEFAULT 0,
  shipping_price        NUMERIC,
  shipping_type         TEXT,
  delivery_address      TEXT,
  customer_info         JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_reference     TEXT,
  paystack_reference    TEXT,
  payment_method        TEXT,
  discount_code         TEXT,
  escrow_status         TEXT,
  commission_rate       NUMERIC,
  funds_released_at     TIMESTAMPTZ,
  auto_release_date     TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  sent_photo_url        TEXT,
  received_at           TIMESTAMPTZ,
  received_photo_url    TEXT,
  waybill_park_id       TEXT,
  waybill_park_name     TEXT,
  deal_thread_id        TEXT,
  availability_status   TEXT,
  wait_time_days        INT,
  wait_time_expires_at  TIMESTAMPTZ,
  availability_reason   TEXT,
  buyer_wait_response   TEXT,
  dispute               JSONB,
  notes                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  refunds               JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message          JSONB,
  seller_unread_count   INT NOT NULL DEFAULT 0,
  buyer_unread_count    INT NOT NULL DEFAULT 0,
  seller_accepted_at    TIMESTAMPTZ,
  preparing_at          TIMESTAMPTZ,
  payment_verified_at   TIMESTAMPTZ,
  raw                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_paystack_ref
  ON orders (paystack_reference)
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> '';

CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON orders (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_seller_created
  ON orders (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_post
  ON orders (post_id)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_deal_thread
  ON orders (deal_thread_id)
  WHERE deal_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_timeline_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  status      TEXT,
  text        TEXT,
  actor_id    TEXT,
  actor_role  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_timeline_order
  ON order_timeline_events (order_id, created_at ASC);
