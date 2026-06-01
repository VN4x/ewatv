---
name: ewatv-schedule-timeline
description: Build ewatv schedule timeline UI, recompute start_at, autopilot, and gap insertion. Use for /schedules page and schedule_items logic.
---

# ewatv schedule timeline skill

## Data model

- `schedules`: per `channel_id` + `schedule_date`, `autopilot` flag.
- `schedule_items`: `position`, `start_at` (timestamptz), `duration_ms`, `transition_ms` (default 2000), `video_id`, `source_snapshot` jsonb.

## Gap / black screen (1500ms)

Insert rows with:

```json
{ "kind": "gap", "duration_ms": 1500, "show_logo": true }
```

`video_id` = null. Player keeps logo on during gap; Mist plays `MIST_GAP_ASSET_PATH` (e.g. `/media/gap-black.mp4`).

Helper: `insertGapItems()` and `scheduleItemsToPlsLines({ insertGaps: true })` in `src/lib/mist/playlist.server.ts`.

## Recompute timing

After drag/drop or duration edit, run `recomputeStartTimes(items, dayStart)` from `src/lib/schedule/timeline.server.ts`:

```text
next_start = prev_start + duration_ms + transition_ms
```

## Future /schedules UI

- Calendar picks `schedule_date` → load items ordered by `position`.
- On reorder: update positions, call recompute, batch upsert `start_at`.
- Autopilot: server cron `runAutopilot` 24h before (not implemented yet) — generate items then `pushScheduleToMist`.

## Importers (later)

Stage in `playlists_import` table (if added) or parse client-side → create `videos` + `schedule_items`.

Supported formats per plan: m3u, txt, csv, markdown.
## Autopilot (channel-level, weekly)

- **Toggle:** `channels.settings.autopilot_enabled` — stays on until user turns off (`updateChannelAutopilot`)
- **Horizon:** rolling **7 days** (today … today+6), `AUTOPILOT_WEEK_DAYS` env override
- **Cron:** `POST /api/cron/autopilot` — fills **empty** days only (won't overwrite manual schedules)
- **Push:** today's air date still auto-pushes when `playout_active`
- **UI:** `/schedules` → Autopilot weekly switch; **Run autopilot** = refresh empty week days

