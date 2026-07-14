-- Add product title for deal-room / listing display (caption stays in description)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS title TEXT;
