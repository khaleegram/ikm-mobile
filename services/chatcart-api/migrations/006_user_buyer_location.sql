-- Buyer's saved delivery location, captured at checkout so a repeat buyer does not retype it.
--
-- Restored: this file was committed empty, but the migration had already run in production
-- (users.market_buyer_location exists and is read by users.mjs). The SQL below matches what
-- actually ran, and IF NOT EXISTS keeps it safe to re-run.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS market_buyer_location JSONB;
