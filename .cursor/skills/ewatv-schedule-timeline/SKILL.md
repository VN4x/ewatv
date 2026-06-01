---
name: ewatv-schedule-timeline
description: ewatv Schedules UI, channel autopilot weekly, saveScheduleAndPush, dayparts, drag-and-drop, and daily Mist air-date rules.
---

# ewatv schedules & timeline

## Channel-level autopilot (persistent)

- **`channels.settings.autopilot_enabled`** — on until user turns off (not per-date UI state)
- **`channels.settings.autoplay_week_days`** — default 7 (rolling horizon)
- Toggle: `updateChannelAutopilot` in `src/lib/api/autopilot.functions.ts`
- UI: `/schedules` — “Autopilot weekly (7 days)”

## Weekly DB vs daily Mist

| | Postgres | Mist |
|---|----------|------|
| Autopilot cron + toggle | Fills **today…today+6** (empty slots only) | — |
| Air day | Row for that calendar date | **Today's** `.pls` pushed |
| Future day | Stored | Pushed when date becomes today (**04:00 cron**) |

Won't overwrite days that already have `schedule_items`.

## Save flow

- **`saveScheduleAndPush`** — persists items + pushes if `playout_active` && **today**
- Sets `schedules.autopilot` from channel `autopilot_enabled`
- Toast explains skip reason for future/past dates

## Timeline fields

- `schedule_items`: `position`, `start_at`, `duration_ms`, `transition_ms` (default 2000)
- Recompute: `recomputeStartTimes()` in `src/lib/schedule/timeline.server.ts`
- Gaps: `video_id: null`, `source_snapshot: { kind: "gap", duration_ms: 1500 }`

## Generator (autopilot)

- `generateAutopilotScheduleItems()` — daypart slots (primetime 18–23, night 23–06, day 06–18)
- Avoid same `category` within last 3 picks
- `generateWeeklySchedulesForChannel()` — skips non-empty days

## UI routes

- `/schedules` — Lovable DnD editor (`@dnd-kit`)
- **Run autopilot** — refresh empty days in horizon for channel
- **Retry Mist push** — manual recovery
- **Playout active** — master switch for Mist

## 04:00 cron

See skill `ewatv-autopilot-cron` — push today before early viewers.

## Not yet / Lovable

- m3u/csv/md importers
- Calendar month view polish
- `nowPlaying` on playout page (separate Lovable task)
