-- Market posts as Postgres source of truth (expand users + posts bodies)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS store_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS store_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'buyer',
  ADD COLUMN IF NOT EXISTS market_location JSONB,
  ADD COLUMN IF NOT EXISTS follower_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fcm_tokens TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS posts (
  id                TEXT PRIMARY KEY,
  poster_id         TEXT NOT NULL REFERENCES users(id),
  media_type        TEXT NOT NULL DEFAULT 'image_gallery',
  status            TEXT NOT NULL DEFAULT 'active',
  description       TEXT,
  price             NUMERIC,
  is_negotiable     BOOLEAN DEFAULT false,
  hashtags          TEXT[] DEFAULT '{}',
  location          JSONB,
  contact_method    TEXT DEFAULT 'in-app',
  cover_url         TEXT,
  video_url         TEXT,
  video_duration_ms INT,
  video_meta        JSONB,
  sound_meta        JSONB,
  likes_count       INT NOT NULL DEFAULT 0,
  views_count       INT NOT NULL DEFAULT 0,
  comments_count    INT NOT NULL DEFAULT 0,
  liked_by          TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_poster ON posts (poster_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_hashtags ON posts USING GIN (hashtags);

CREATE TABLE IF NOT EXISTS post_images (
  id          BIGSERIAL PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_post_images_post ON post_images (post_id, sort_order);

CREATE TABLE IF NOT EXISTS trending_hashtags (
  tag         TEXT PRIMARY KEY,
  count       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
