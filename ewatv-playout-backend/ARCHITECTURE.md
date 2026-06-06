# EWATV Linear Playout Backend — Architecture

Self-hosted linear TV playout engine (Strimm replacement) optimized for **Hetzner AX42** (Ryzen 7 PRO, 64 GB RAM, NVMe RAID + 2 TB bulk storage).

## Design goals

| Goal | Approach |
|------|----------|
| **24/7 stability** | Pre-segmented CMAF assets; playout = manifest rotation, not live transcode |
| **Mobile-first HLS/DASH** | LL-HLS + DASH-IF CMAF; 2–4 ABR ladders only where needed |
| **Multi-channel** | One playout goroutine per active channel; shared segment cache |
| **Frontend reuse** | REST + WebSocket APIs mirroring existing `ewatv` Supabase contracts |
| **Transferable** | Clean module boundaries; OpenAPI spec; no Supabase lock-in for playout plane |

## System context

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  ewatv frontend (TanStack Start + React) — github.com/VN4x/ewatv        │
│  Collections │ Schedules │ Settings │ embed /playout / LinearPlayer     │
└──────────────┬──────────────────────────────┬───────────────────────────┘
               │ REST / WS (JWT)               │ HLS/DASH manifest + segments
               ▼                               ▼
┌──────────────────────────────┐   ┌────────────────────────────────────┐
│  ewatv-playout-backend (Go)  │   │  CDN / Caddy reverse proxy         │
│  Fiber API + playout engine  │──▶│  /hls/{slug}/index.m3u8            │
│  FFmpeg ingest (batch)       │   │  /dash/{slug}/manifest.mpd         │
└──────────────┬───────────────┘   └────────────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
  PostgreSQL         Redis
  (schedules,        (now-playing,
   library meta)      viewer counts,
                     segment hot cache)
       │
       ▼
  Local NVMe (hot) + HDD (archive)
  /data/videos/{id}/source.mp4
  /data/segments/{id}/cmaf/...
  /data/channels/{slug}/live/...
```

## Integration with existing frontend

The frontend today uses **Supabase Postgres** as source of truth and **Mist** for HLS. Migration path:

### Phase A — Dual mode (recommended first ship)

| Frontend call | Today (Mist) | New backend |
|---------------|--------------|-------------|
| `nowPlaying({ channelSlug })` | TanStack server fn → Supabase + `VITE_MIST_HLS_BASE` | Same shape; `hlsUrl` points to Go backend `/hls/{slug}/index.m3u8` |
| Collections / Schedules CRUD | Supabase direct | **Keep Supabase** OR sync via webhook; backend reads schedule for playout |
| Channel `playout_mode` | N/A | `hls_broadcast` → this backend; `client` → existing cloud path |

Minimal frontend change: set `VITE_MIST_HLS_BASE=https://playout.example.com/hls` (or dedicated env `VITE_PLAYOUT_HLS_BASE`).

### Phase B — Backend owns library + schedules

Backend exposes OpenAPI-compatible endpoints; frontend switches from Supabase client to API client for admin. Auth: JWT validated against same user store (Supabase JWKS or shared secret during transition).

### `nowPlaying` contract (must preserve)

```json
{
  "streamName": "news",
  "hlsUrl": "https://playout.example.com/hls/news/index.m3u8",
  "fallbackYoutubeUrl": null,
  "channelName": "News",
  "channelSlug": "news",
  "overlayLogoUrl": "https://…",
  "overlays": [],
  "current": { "title": "…", "startedAt": "…", "durationMs": 3600000, "isGap": false, … },
  "next": { "title": "…", "startsAt": "…", "durationMs": 1800000, … }
}
```

## Decision log (confirmed)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Database | Standalone Postgres 16 on AX42; Adminer optional (`profile: admin`); hosted Supabase kept for frontend auth only |
| 2 | Auth | Validate **Supabase JWT** (HS256, project JWT secret via Podman secret or Infisical) |
| 3 | Ingest | Pull **`source_ref` HTTPS URL** → `/data/videos/{id}/source.mp4` → ffprobe → FFmpeg CMAF pack |
| 4 | Containers | **Podman** compose + quadlets + `podman secret`; Infisical optional for teams |

Local dev clone: `A:\001code\1 Cursor\ewatv\ewatv-playout-backend` — see `LOCAL_SYNC.md`.

## Module map (6-agent workstream)

| Agent | Module | Responsibility |
|-------|--------|----------------|
| **1 — Platform** | `cmd/`, `internal/config`, `internal/platform` | Boot, Viper, Zerolog, graceful shutdown, metrics |
| **2 — Library** | `internal/library`, `internal/ingest` | Video CRUD, FFmpeg probe, CMAF packager, thumbnails |
| **3 — Schedule** | `internal/schedule` | Weekly templates, day timelines, conflict detection, autopilot |
| **4 — Playout** | `internal/playout` | Wall-clock scheduler, gap/slate, manifest writer, segment prefetch |
| **5 — Stream** | `internal/stream` | HLS LL + DASH serving, range requests, cache headers |
| **6 — API** | `internal/api`, `api/openapi.yaml` | REST, WebSocket now-playing, JWT, rate limits |

## Playout engine (core algorithm)

```text
Every 500ms per channel:
  1. Load today's schedule_items (cached in Redis, TTL 60s)
  2. at := wall_clock(channel.timezone)
  3. Find current item + offset within item
  4. If item changed → update live sliding-window manifest
  5. Prefetch next item segments (N+1) into RAM disk cache

Manifest strategy (no live transcode):
  - Each video pre-packaged to fMP4/CMAF segments on ingest
  - Live playlist = DISCONTINUITY + segment URLs with PROGRAM-DATE-TIME
  - Gaps: loop /media/slate/black_2s.m4s + player-side overlay (matches ewatv)
```

## Hetzner AX42 tuning

| Resource | Setting | Rationale |
|----------|---------|-----------|
| **NVMe RAID** | Hot path: today's manifests + next 2 items' segments | ~20–50 GB active |
| **2 TB HDD** | Full library + cold segments | Sequential read OK for ingest queue |
| **CPU** | FFmpeg ingest: `-threads 0`, max 2 concurrent pack jobs | 8C/16T; leave headroom for 4–8 channels |
| **RAM** | 8 GB segment cache (Redis + mmap), 48 GB for OS page cache | 64 GB total |
| **Network** | 200 concurrent × 5 Mbps ≈ 1 Gbps peak | AX42 1 Gbit port sufficient with ABR cap |

### FFmpeg presets (ingest, not live)

```bash
# Single-rendition H.264 720p CMAF (copy when source matches)
ffmpeg -i source.mp4 -c:v copy -c:a aac -b:a 128k \
  -f hls -hls_segment_type fmp4 -hls_time 2 -hls_playlist_type vod \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename 'seg_%05d.m4s' index.m3u8
```

Live channel output uses **static segment URLs** stitched in the playout scheduler — no `-re` transcode loop.

## Data model (foundation)

Aligned with existing Supabase schema for easy migration:

- `channels` — slug, stream name, timezone, settings JSONB
- `videos` — library metadata, storage path, duration, probe info
- `schedules` — one row per channel per calendar day
- `schedule_items` — ordered timeline with `start_at`, `duration_ms`, `transition_ms`, `source_snapshot`

Backend adds playout-specific tables (later migrations):

- `video_segments` — CMAF pack status, renditions
- `playout_state` — per-channel cursor, last manifest hash
- `ingest_jobs` — FFmpeg queue

## API surface (foundation → full)

| Method | Path | Status |
|--------|------|--------|
| GET | `/health` | ✅ Foundation |
| GET | `/ready` | ✅ Foundation (DB + Redis) |
| GET | `/metrics` | ✅ Foundation (Prometheus) |
| GET | `/v1/channels/{slug}/now-playing` | Phase 2 |
| GET | `/hls/{slug}/index.m3u8` | Phase 4 |
| GET | `/dash/{slug}/manifest.mpd` | Phase 4 |
| CRUD | `/v1/videos`, `/v1/schedules` | Phase 2–3 |

## Security

- JWT bearer (HS256 dev / RS256 prod with Supabase JWKS)
- Rate limiting on public manifest routes
- Input validation via go-playground/validator
- HTML escape on all JSON string fields in admin responses
- No user-supplied FFmpeg args (fixed preset templates only)

## Deployment

- **Docker Compose** for dev (Postgres 16, Redis 7, backend)
- **Podman quadlets** for production on AX42
- **Caddy** TLS termination + `Cache-Control` for `.m4s`/`.ts`
- **VictoriaMetrics** scrape `/metrics`

## Next steps (confirm before Phase 2)

1. **DB strategy**: Read-only replica of Supabase Postgres vs standalone DB with sync?
2. **Auth**: Shared Supabase JWT vs standalone admin users?
3. **Ingest**: Upload API on AX42 vs cloud URL pull + local pack?

Default recommendation: **standalone Postgres on AX42** with nightly sync from Supabase for schedules; library ingested locally from `source_ref` URLs.
