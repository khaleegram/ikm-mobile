-- ChatCart Version One — feed tables only
-- Run once against Neon: neondb

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_liked_posts (
  user_id  TEXT NOT NULL REFERENCES users(id),
  post_id  TEXT NOT NULL,
  liked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS user_seen_posts (
  user_id   TEXT NOT NULL REFERENCES users(id),
  post_id   TEXT NOT NULL,
  seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dwell_sec NUMERIC,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS post_scores (
  post_id       TEXT PRIMARY KEY,
  poster_id     TEXT NOT NULL,
  hashtags      TEXT[] DEFAULT '{}',
  media_type    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  total_points  NUMERIC NOT NULL DEFAULT 0,
  score         NUMERIC NOT NULL DEFAULT 0,
  breakdown     JSONB NOT NULL DEFAULT '{}',
  views_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_rank ON post_scores (status, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_hashtags ON post_scores USING GIN (hashtags);

CREATE TABLE IF NOT EXISTS interactions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  post_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  dwell_sec  NUMERIC,
  media_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_taste ON interactions (user_id, action, created_at DESC);
