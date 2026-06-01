---
name: ewatv-mist-playout
description: MistServer VPS playout, daily .pls push, playlist-sync, HLS URLs, gaps, and custom hls.js player. Use for deploy/mist, playout UI, pushScheduleToMist, and Mist debugging.
---

# ewatv Mist playout

## Split of responsibilities

| Component | Role |
|-----------|------|
| **MistServer** (VPS) | 24/7 encode/concat; outputs HLS `/hls/{stream}/index.m3u8` |
| **playlist-sync** | Writes `.pls` on VPS; calls Mist `addstream` |
| **Lovable app** | Schedules DB, **custom player** (hls.js), overlays, now/next from Postgres |
| **04:00 cron** | Push **today** to Mist; weekly fill in DB |

**Do not** use Mist’s built-in HTML/Meta-Player as the product viewer.

## Ports (defaults)

- Mist API: **4242** (`/api2`, JSON `command=`)
- Mist HTTP/HLS: **8080** — keep `/hls/{stream}/` prefix behind Caddy
- playlist-sync: **8787** (internal); public via Caddy `/playlist-sync/`

## Daily push (not weekly on Mist)

- `pushScheduleToMist` / `persistScheduleAndPush` → builds `.pls` for **one schedule day**
- `autoPushIfNeeded` only pushes when `schedule_date` is **today** (air TZ)
- **04:00** cron runs `pushTodayAirScheduleForChannel` after weekly autopilot fill

## Gaps (1500ms black)

- DB: `schedule_items` with `source_snapshot.kind === "gap"`
- VPS: `/media/gap-black.mp4`
- Logo: **player-side** (visible during gaps); not burned into Mist

## Server functions (do not break contracts)

| Function | File |
|----------|------|
| `pushScheduleToMist` | `src/lib/api/mist.functions.ts` |
| `saveScheduleAndPush` | `src/lib/api/schedule.functions.ts` |
| `executePushScheduleToMist` | `src/lib/mist/push-schedule.server.ts` |
| `runAutopilotJobs` | `src/lib/schedule/autopilot-cron.server.ts` |

## `.pls` rules

- **Local paths only** in `.pls` (`/media/...`, `/playlists/...`)
- Remote HTTPS: single-item **direct smoke** via `addstream` URL, not weekly `.pls`
- `insertGaps: true` on push inserts black between videos in `.pls`

## Player (app-side)

- **hls.js:** `lowLatencyMode: true`, `backBufferLength: 30`, `maxBufferLength: 30`
- **Env:** `VITE_MIST_HLS_BASE` + stream name from `channels.mist_stream_name` or `slug`
- **nowPlaying** server fn (to implement in Lovable): DB schedule + wall clock, not Mist UI

## VPS layout

```
deploy/mist/
  docker-compose.yml
  media/gap-black.mp4
  media/videos/{uuid}.mp4
  playlists/{stream}.pls
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| No HLS | Mist :4242, stream `always_on`, Caddy `/hls` not stripped |
| Push 401 | `MIST_PLAYLIST_SYNC_TOKEN` |
| Empty playout | **Playout active** + today's schedule has items |
| Early viewers wrong lineup | Cron at **04:00** Helsinki, not 05:00+ |
