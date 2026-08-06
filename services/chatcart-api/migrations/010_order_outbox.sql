-- Neon order write primary: durable Firestore mirror outbox.
-- Applied after 008/009. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS order_outbox (
  id            BIGSERIAL PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'firestore_order',
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_outbox_pending
  ON order_outbox (created_at ASC)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_order_outbox_order
  ON order_outbox (order_id, created_at DESC);
