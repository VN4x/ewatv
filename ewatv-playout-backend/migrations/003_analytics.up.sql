-- Analytics: as-run logs + viewer watch sessions (Phase 1)

CREATE TABLE IF NOT EXISTS as_run_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  schedule_item_id UUID,
  video_id         UUID REFERENCES videos(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT '',
  is_gap           BOOLEAN NOT NULL DEFAULT false,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_as_run_channel_started
  ON as_run_events (channel_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_as_run_open
  ON as_run_events (channel_id)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS watch_sessions (
  id                UUID PRIMARY KEY,
  channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  country_code      CHAR(2),
  user_agent_hash   TEXT,
  total_watch_ms    BIGINT NOT NULL DEFAULT 0 CHECK (total_watch_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_watch_sessions_channel
  ON watch_sessions (channel_id);

CREATE INDEX IF NOT EXISTS idx_watch_sessions_active
  ON watch_sessions (last_heartbeat_at)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_watch_sessions_started
  ON watch_sessions (started_at);
