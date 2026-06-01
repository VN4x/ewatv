# Headless Linear TV — Build Plan (v1, single-tenant)

## Recommended architecture

```text
┌─────────────────────────┐      ┌────────────────────────────┐
│  Lovable web app        │      │  VPS                       │
│  (TanStack Start)       │      │                            │
│  - Collections UI       │ ───► │  Caddy (auto-TLS)          │
│  - Schedules UI         │      │   ├─ /api/* → MistServer   │
│  - Playout viewer       │ ◄─── │   └─ /hls/* → MistServer   │
│  - Server fns (API)     │ HLS  │                            │
└──────────┬──────────────┘      │  MistServer                │
           │                     │   - Pulls signed Mega URLs │
           ▼                     │   - Emits LL-HLS + DASH    │
┌─────────────────────────┐      │   - Playlist API           │
│  Lovable Cloud Postgres │      └────────────────────────────┘
│  (collections, schedule │                ▲
│   items, channels)      │                │ signed URLs
└─────────────────────────┘                │
           │                     ┌─────────┴──────────────────┐
           └────── signs ───────►│  Mega.io S3-compatible     │
                                 │  (mp4/mkv/mp3/jpg)         │
                                 └────────────────────────────┘
```

### Why Caddy over nginx for you

- Automatic Let's Encrypt TLS (zero-config certificates).
- 5-line Caddyfile vs ~40 lines of nginx for the same reverse proxy + WebSocket + HLS headers.
- Same performance for this workload; you're not CPU-bound at the proxy.
- nginx is fine if you already know it, but Caddy will save you a day of cert/config pain.

## What gets built where

### A. On your VPS (one-time, ~1 hour)

1. Install podman + podman-compose +podman secrets + tailscale.
2. Run MistServer container (open-source build is fine for v1; LL-HLS works in OSS).
3. Install Caddy, point your domain at the VPS, Caddyfile:
  - `tv.yourdomain.com` → MistServer HTTP API + HLS output
  - WebSocket upgrade enabled for MistServer's control channel
4. Create a MistServer API user; store credentials as Lovable secrets (`MIST_API_URL`, `MIST_API_USER`, `MIST_API_PASS`).

I'll give you the exact Caddyfile + docker-compose.yml as part of the build.

### B. In the Lovable app

**Database (Lovable Cloud / Postgres)**

- `collections` — folder hierarchy (parent_id self-ref).
- `videos` — id, collection_id, title, description, duration_sec, source_type (`mega_s3` | `youtube` | `url` | `vimeo` | `dailymotion`), source_ref, tags[], category, daypart (`primetime` | `night` | `any`), hide_overlay (bool) for logo not on-hover, auto_subs (bool), created_at.
- `channels` — id, name, mist_stream_name, overlay_logo_url, settings.
- `schedules` — id, channel_id, date, autopilot (bool).
- `schedule_items` — id, schedule_id, position, video_id, start_at (timestamptz, ms precision), duration_ms, transition_ms (default 1500), source_snapshot (jsonb).
- `playlists_import` — staging for m3u/txt/csv/markdown imports.

All tables RLS-enabled, scoped to owner. Single-tenant now, but structure is workspace-ready for later.

**Pages / routes**

1. `/collections` — tree view, table with: #, title, description, length, url, tag, category, daypart toggle, hide-overlay toggle, auto-subs toggle, search. Drag-to-folder. Bulk edit.
2. `/schedules` — calendar (month/week/day). Per-day timeline editor:
  - Auto-create daily/weekly using rules (daypart respect, no back-to-back duplicates, fill 24h). saved schedules could be reused when going back in calendar and pressing button "reuse" > keeps content and order but changes timing according to current schedules.
  - Autopilot toggle (cron-style server fn runs 24h ahead IF no existing schedule ).
  - Drag-and-drop reorder, add/remove from collections picker, search.
  - Importers: m3u, txt, csv, markdown → staging → urel-s mapped to videos.
  - **Frame/second-accurate timing**: every reorder recomputes `start_at` for all downstream items using `duration_ms + transition_ms`. Transitions default 1500ms  use black screen similar to fallback image.
3. `/playout/:channel` — embedded hls.js player consuming MistServer's LL-HLS output:
  - Fully reponsive
  -  on hover overlay with opacityglassmorhism blurring mid-transparent effect:  now-playing title + description, total/remaining time, next-on-hover. 
  - On hover Controls: play/pause, fullscreen, volume/mute only.
  - Precache is handled by MistServer (LL-HLS partial segments + next-asset pre-pull). The browser just plays a live stream — no manual stitching needed.
  - Overlay logo shown unless current video has `hide_overlay = true`. Overlay logo in left upper corner, logo width about 8% width of screen. logo png file in vps + fallback to [mega.io](http://mega.io)  (+ fallback to imgur or similar or lovable supabase);

**Server functions (createServerFn)**

- `signMegaUrl(videoId)` → short-lived signed URL for MistServer to pull.
- `pushScheduleToMist(scheduleId)` → translates schedule_items → MistServer Playlist API (`/api/playlist/...`) so Mist actually plays the timeline.
- `nowPlaying(channelId)` → reads Mist's stream state + joins DB for title/description/next.
- `runAutopilot()` → invoked by a scheduled task daily; generates next 24h per channel.
- `importPlaylist(file, kind)` → parses m3u/txt/csv/markdown into staging.
- `autoGenerateSchedule({channelId, date, rules})` — rule-based:
  1. Bucket videos by daypart (primetime 18:00–23:00, night 23:00–06:00, any).
  2. Greedy fill each daypart window, avoiding duplicate categories within N items.
  3. Round to nearest second; keep 2 second black screen as fallback image, run next ; 

implement hardened security

**Player precache strategy (no MistServer hack needed)**

- hls.js config: `lowLatencyMode: true`, `backBufferLength: 30`, `maxBufferLength: 30`.
- MistServer emits LL-HLS partial segments → ~2s glass-to-glass.
- "Next on hover" reads from `schedule_items` directly (DB), independent of Mist.

## Technical details (for reference)

- **MistServer integration**: REST/JSON API at `:24241`. We push a playlist via `addstream` with type `playlist`, each entry being a signed Mega URL + in/out points. Mist handles seamless concat. Logo overlay via Mist's `logo` trigger or a separate overlay layer in the player (we'll use player-side overlay for flexibility — easier to toggle per-item).
- **YouTube/Vimeo/Dailymotion**: skip in v1 as Mist can't ingest these directly.  for v2 we might decide to run `yt-dlp` server-side to resolve to a direct stream URL that Mist ingests.
- **Mega S3**: stored as `mega_s3` source_type with `bucket/key`. `signMegaUrl` uses AWS SDK v3 with Mega's S3 endpoint to generate a 1-hour presigned GET URL each time Mist refreshes the playlist (we push refreshed URLs every morning [5.am](http://5.am) CET+2 or manual button press "new on mega"). 
- **Caddyfile sketch**:
  ```
  tv.yourdomain.com {
    reverse_proxy /api/* localhost:24241
    reverse_proxy /hls/*  localhost:18784
    reverse_proxy /dash/* localhost:18784
  }
  ```
- **Secrets needed**: `MIST_API_URL`, `MIST_API_USER`, `MIST_API_PASS`, `MEGA_S3_ENDPOINT`, `MEGA_S3_ACCESS_KEY`, `MEGA_S3_SECRET_KEY`, `MEGA_S3_BUCKET`.

## Build order (proposed milestones)

1. **DB schema + Collections page** (CRUD, folders, tags, dayparts, search).
2. **MistServer wiring** (VPS setup guide + server fn that pushes a single video to Mist and plays it in `/playout`).
3. **Schedules page** (manual CRUD, drag-and-drop, transitions, timing recompute, randomness confimrmativ (no same show concurrently, check series in correct order no by title etc). Plan to integrate self learning Ai agent for analytics, schedule creation and natural text based editing (for example "after currently playing add the url i just uploaded" or change the mood to music etc)  in later phases.
4. **Importers** (m3u/txt/csv/markdown).
5. **Rule-based auto-generator + autopilot cron**.
6. **Playout polish** (overlay, now/next, precache tuning, YouTube fallback embed).
7. n18i EST ET

Each milestone is independently shippable so you can start migrating off Strimm after milestone 3.

## Open items I'll confirm during build

- domain name for the VPS (for the Caddyfile). is [www.ewatv.com/tv1](http://www.ewatv.com) 
- start with 1 channel in v1, (later implement "add channel" with shareable schedules browser)
- the upload-to-Mega flow i keep uploading via Mega directly.