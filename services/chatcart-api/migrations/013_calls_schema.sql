-- Voice/video calls between the two people in a deal thread.
--
-- Deliberately small: the row is the *record* of a call, not the live media. Audio and video never
-- touch this server — WebRTC sends them phone-to-phone. What lives here is who rang whom, how long
-- it lasted, and how it ended, which is what the chat history and any later dispute needs.

CREATE TABLE IF NOT EXISTS calls (
  id             TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL,
  caller_id      TEXT NOT NULL REFERENCES users(id),
  callee_id      TEXT NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL DEFAULT 'audio',    -- audio | video
  status         TEXT NOT NULL DEFAULT 'ringing',  -- ringing | active | ended | missed | declined | failed
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at    TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  duration_sec   INT,
  ended_by       TEXT
);

CREATE INDEX IF NOT EXISTS idx_calls_thread ON calls (thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls (callee_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls (caller_id, started_at DESC);

-- One live call per person, enforced by the database rather than by hoping the app is well
-- behaved. Someone already ringing cannot be rung again, and cannot start a second call. This is
-- the same guarantee a phone gives you.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_live_callee
  ON calls (callee_id) WHERE status IN ('ringing', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_live_caller
  ON calls (caller_id) WHERE status IN ('ringing', 'active');
