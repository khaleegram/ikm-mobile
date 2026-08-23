-- Public market profile bio (seller page reads Neon identity).
-- Safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT;
