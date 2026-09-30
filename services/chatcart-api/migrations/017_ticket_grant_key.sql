-- Ticket grants need an explicit idempotency key.
--
-- 016 made "the same grant is never issued twice" a unique index over
-- (identity_key, source, expires_at). That is right for a one-ticket grant and
-- wrong for any tier that grants more than one: the second ticket collides with
-- the first and is silently dropped.
--
-- A referral tier that awards two monthly tickets would therefore award one, and
-- nothing would report it. The key needs a slot as well.

ALTER TABLE promo_tickets
  ADD COLUMN IF NOT EXISTS grant_key TEXT;

-- Backfill what 016's index was already enforcing.
UPDATE promo_tickets
   SET grant_key = source || ':' || identity_key || ':' ||
                   COALESCE(to_char(expires_at, 'YYYY-MM'), 'once') || ':0'
 WHERE grant_key IS NULL;

-- The old index is now the weaker statement; grant_key subsumes it.
DROP INDEX IF EXISTS idx_promo_tickets_grant_once;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_tickets_grant_key
  ON promo_tickets (grant_key)
  WHERE grant_key IS NOT NULL;

-- Every ticket must carry one, or a grant could slip past the guard.
ALTER TABLE promo_tickets
  ALTER COLUMN grant_key SET NOT NULL;
