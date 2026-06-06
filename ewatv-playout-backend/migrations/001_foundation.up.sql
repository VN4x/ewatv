-- EWATV playout backend — foundation schema
-- Compatible with ewatv Supabase tables; adds local storage + pack fields.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE video_source AS ENUM (
  'local',
  'direct_url',
  'mega_s3',
  'youtube',
  'vimeo',
  'dailymotion'
);

CREATE TYPE daypart AS ENUM ('any', 'primetime', 'night');

CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL,
  parent_id   UUID REFERENCES collections(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id);
CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_id);

CREATE TABLE IF NOT EXISTS videos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL,
  collection_id  UUID REFERENCES collections(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  length_sec     INTEGER NOT NULL DEFAULT 0 CHECK (length_sec >= 0),
  source_type    video_source NOT NULL DEFAULT 'local',
  source_ref     TEXT NOT NULL DEFAULT '',
  storage_path   TEXT,
  width          INTEGER,
  height         INTEGER,
  codec_video    TEXT,
  codec_audio    TEXT,
  thumbnail_path TEXT,
  pack_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (pack_status IN ('pending', 'processing', 'ready', 'failed')),
  tags           TEXT[] NOT NULL DEFAULT '{}',
  category       TEXT,
  daypart        daypart NOT NULL DEFAULT 'any',
  hide_overlay   BOOLEAN NOT NULL DEFAULT false,
  auto_subs      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id);
CREATE INDEX IF NOT EXISTS idx_videos_collection ON videos(collection_id);
CREATE INDEX IF NOT EXISTS idx_videos_pack_status ON videos(pack_status);

CREATE TABLE IF NOT EXISTS channels (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID NOT NULL,
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  stream_name          TEXT NOT NULL,
  timezone             TEXT NOT NULL DEFAULT 'Europe/Helsinki',
  overlay_logo_url     TEXT,
  fallback_youtube_url TEXT,
  settings             JSONB NOT NULL DEFAULT '{}',
  playout_active       BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT channels_slug_format CHECK (slug ~ '^[a-z0-9._-]+$')
);

CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);

CREATE TABLE IF NOT EXISTS schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL,
  schedule_date DATE NOT NULL,
  autopilot     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, schedule_date)
);

CREATE INDEX IF NOT EXISTS idx_schedules_channel_date ON schedules(channel_id, schedule_date);

CREATE TABLE IF NOT EXISTS schedule_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  video_id        UUID REFERENCES videos(id) ON DELETE SET NULL,
  position        INTEGER NOT NULL CHECK (position >= 0),
  start_at        TIMESTAMPTZ NOT NULL,
  duration_ms     INTEGER NOT NULL CHECK (duration_ms > 0),
  transition_ms   INTEGER NOT NULL DEFAULT 0 CHECK (transition_ms >= 0 AND transition_ms <= 60000),
  source_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, position)
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_schedule ON schedule_items(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_start ON schedule_items(schedule_id, start_at);

-- Playout engine state (per channel)
CREATE TABLE IF NOT EXISTS playout_state (
  channel_id       UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  schedule_date    DATE,
  current_item_id  UUID,
  offset_ms        INTEGER NOT NULL DEFAULT 0,
  manifest_etag    TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FFmpeg ingest queue
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id     UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  error_message TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status);

COMMENT ON TABLE videos IS 'Library assets; local playout reads storage_path + pre-packaged CMAF segments';
COMMENT ON TABLE schedule_items IS 'Timeline slots; source_snapshot preserves source at schedule time (ewatv compatible)';
