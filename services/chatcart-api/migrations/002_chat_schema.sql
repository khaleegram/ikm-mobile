-- ChatCart — Deal Thread schema
-- Run after 001_feed_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chat_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         TEXT NOT NULL,
  buyer_id        TEXT NOT NULL,
  seller_id       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'browsing',
  post_snapshot   JSONB NOT NULL DEFAULT '{}',
  linked_order_id TEXT,
  last_message    TEXT,
  last_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_active
  ON chat_threads (post_id, buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_seller
  ON chat_threads (seller_id, last_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chat_threads_buyer
  ON chat_threads (buyer_id, last_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS chat_inbox (
  user_id         TEXT NOT NULL REFERENCES users(id),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  peer_id         TEXT NOT NULL,
  unread_count    INT NOT NULL DEFAULT 0,
  last_preview    TEXT,
  last_at         TIMESTAMPTZ,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_inbox_user
  ON chat_inbox (user_id, last_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id       TEXT,
  type            TEXT NOT NULL,
  body            TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  client_msg_id   TEXT UNIQUE,
  search_vector   tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(body, ''))
  ) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON chat_messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_search
  ON chat_messages USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS chat_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  buyer_id        TEXT NOT NULL,
  seller_id       TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'NGN',
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  parent_offer_id UUID REFERENCES chat_offers(id),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_offers_thread
  ON chat_offers (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  url          TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   INT,
  duration_sec INT,
  width        INT,
  height       INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
  ON chat_attachments (message_id);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  thread_id   UUID REFERENCES chat_threads(id),
  message_id  UUID REFERENCES chat_messages(id),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_reports_status
  ON chat_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_reports_reported
  ON chat_reports (reported_id, created_at DESC);
