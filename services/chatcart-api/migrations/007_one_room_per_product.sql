-- One deal room per buyer + product (dedupe existing, then unique index)

-- Keep the most recently active thread per (post_id, buyer_id); drop older duplicates.
-- Related inbox/messages/offers cascade via FK ON DELETE CASCADE.
DELETE FROM chat_threads
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY post_id, buyer_id
        ORDER BY COALESCE(last_at, updated_at, created_at) DESC, created_at DESC
      ) AS rn
    FROM chat_threads
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_one_per_buyer_post
  ON chat_threads (post_id, buyer_id);
