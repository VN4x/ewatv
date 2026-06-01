---
name: ewatv-autopilot-cron
description: Operate ewatv daily autopilot cron at 04:00 air TZ, weekly DB fill, daily Mist push. Use for deploy/cron, AUTOPILOT_* secrets, and /api/cron/autopilot.
---

# ewatv autopilot & daily Mist push

## Model (do not confuse)

| Layer | What |
|-------|------|
| **Postgres** | Rolling **7 days** of `schedule_items` when `channels.settings.autopilot_enabled` |
| **Mist HLS** | **One stream** = **today’s** `.pls` only (not all 7 days at once) |
| **04:00 cron** | Refresh empty week days + **push today** before early viewers |

Future days are **scheduled in DB**; they **go live on Mist** when that date becomes “today” (04:00 job + optional manual Save).

## Cron schedule

- **When:** `04:00` or earlier in `AUTOPILOT_TIMEZONE` (default `Europe/Helsinki`).
- **Crontab:** `0 4 * * *` with `CRON_TZ=Europe/Helsinki`
- **Script:** `deploy/cron/autopilot.sh` → `POST /api/cron/autopilot`

## Secrets (Lovable + VPS)

| Secret | Purpose |
|--------|---------|
| `AUTOPILOT_CRON_SECRET` | Bearer / `X-Cron-Secret` for cron endpoint |
| `AUTOPILOT_TIMEZONE` | Calendar dates for today/week (e.g. `Europe/Helsinki`) |
| `AUTOPILOT_WEEK_DAYS` | Horizon length (default `7`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron uses admin client |
| `EWATV_APP_URL` | VPS cron script only |

## Channel settings (`channels.settings` JSON)

- `autopilot_enabled` — stays on until user turns off
- `playout_active` — required for Mist push
- `autopilot_week_days` — default 7
- `last_mist_push_at` / `last_mist_push_error`

## Server entrypoints

- `POST /api/cron/autopilot` — secured cron (see `src/routes/api/cron/autopilot.ts`)
- `runAutopilotCron` — server fn alternative
- `updateChannelAutopilot` — UI toggle + optional immediate weekly fill
- `saveScheduleAndPush` — manual save; pushes **today** if playout active

## Manual vs cron push

- **04:00 cron:** today’s lineup → Mist (primary for early audience)
- **Save on Schedules:** can push today anytime (operators)
- **Future dates in UI:** saved to DB only; toast explains air-date push

## Do not

- Push 7 days to Mist in one job (only last day would remain on stream)
- Use Mist Meta-Player as product UI
- Run cron only at 05:00+ if audience starts at 04:30 — use **04:00 or earlier**
