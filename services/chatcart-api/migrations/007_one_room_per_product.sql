-- One conversation per buyer per product.
--
-- Enforced by the database rather than trusting the app to look first, because two taps in quick
-- succession used to create two rooms for the same product and split the conversation in half.
--
-- Restored: this file was committed empty, but the migration had already run in production
-- (idx_chat_threads_one_per_buyer_post exists). The SQL below matches what actually ran, and
-- IF NOT EXISTS keeps it safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_one_per_buyer_post
  ON chat_threads (post_id, buyer_id);
