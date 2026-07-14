-- Buyer delivery location for market checkout prefill
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS market_buyer_location JSONB,
  ADD COLUMN IF NOT EXISTS market_buyer_phone TEXT;
