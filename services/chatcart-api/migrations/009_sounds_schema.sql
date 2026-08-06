-- Market sounds as first-class Neon entities (replaces Firestore marketSounds / marketSoundSaves).
-- sound_meta on posts remains denormalized for feed cards; this table is the catalog + save target.

CREATE TABLE IF NOT EXISTS sounds (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users(id),
  creator_name    TEXT,
  source_type     TEXT NOT NULL DEFAULT 'uploaded',
  source_uri      TEXT NOT NULL DEFAULT '',
  artwork_url     TEXT,
  duration_ms     INTEGER,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  saved_count     INTEGER NOT NULL DEFAULT 0,
  rights_status   TEXT NOT NULL DEFAULT 'owned',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sounds_active_usage
  ON sounds (status, usage_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sounds_created_by
  ON sounds (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS sound_saves (
  user_id     TEXT NOT NULL REFERENCES users(id),
  sound_id    TEXT NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sound_id)
);

CREATE INDEX IF NOT EXISTS idx_sound_saves_user
  ON sound_saves (user_id, created_at DESC);
