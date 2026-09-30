-- The checkout session behind a Paystack reference.
--
-- A client can crash between "Paystack says paid" and "create the orders". The
-- charge webhook then has a reference, an amount and Paystack metadata — but not
-- the cart, because the cart only ever existed on the phone.
--
-- So the cart is written here at initialize time. That is what lets the webhook
-- rebuild the order from the charge alone, which is the difference between a paid
-- buyer getting their goods and a paid buyer getting nothing.

CREATE TABLE IF NOT EXISTS payment_sessions (
  reference     TEXT PRIMARY KEY,
  uid           TEXT,
  email         TEXT,
  amount        NUMERIC,
  amount_kobo   BIGINT,
  callback_url  TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'initialized',
  finalized_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_uid_created
  ON payment_sessions (uid, created_at DESC)
  WHERE uid IS NOT NULL;

-- The webhook looks a session up by the email on the charge when the reference
-- alone does not match (older client builds that did not send one).
CREATE INDEX IF NOT EXISTS idx_payment_sessions_email_created
  ON payment_sessions (email, created_at DESC)
  WHERE email IS NOT NULL;
