-- Make the ticket grant key a plain unique constraint.
--
-- 017 created it as a *partial* unique index (`WHERE grant_key IS NOT NULL`) and
-- then made the column NOT NULL. Postgres cannot infer a partial index from
-- `ON CONFLICT (grant_key)` without repeating the predicate, so every ticket grant
-- failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" — which is to say the whole ticket system was unusable, and
-- loudly rather than silently.
--
-- With the column NOT NULL the predicate carries no information, so a plain
-- constraint is both correct and inferable.

DROP INDEX IF EXISTS idx_promo_tickets_grant_key;

ALTER TABLE promo_tickets
  DROP CONSTRAINT IF EXISTS promo_tickets_grant_key_key;

ALTER TABLE promo_tickets
  ADD CONSTRAINT promo_tickets_grant_key_key UNIQUE (grant_key);
