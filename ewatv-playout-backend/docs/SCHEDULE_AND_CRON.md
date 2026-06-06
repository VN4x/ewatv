# Weekly schedules vs nightly cron

## Mist (old) — why nightly cron existed

Mist holds **one `.pls` file per stream**. Autopilot wrote 7 days to Postgres, but Mist could only play **today**. A cron at 04:00 pushed today's playlist to the VPS. Without it, viewers saw yesterday's lineup after midnight.

```text
Postgres (7 days) ──04:00 cron──► Mist .pls (today only) ──► HLS
```

## Go playout engine (new) — no nightly push

The engine reads **directly from Postgres** every tick. On calendar day change (channel timezone), it reloads that day's `schedule_items` automatically:

```142:147:ewatv-playout-backend/internal/playout/engine.go
	if rt.scheduleDate != today {
		items, err = e.loadTodaySchedule(ctx, ch, today)
		if err != nil {
			return err
		}
	}
```

```text
Postgres (7 days stored) ──wall clock──► engine picks TODAY ──► HLS manifest
```

| Concern | Mist + cron | Go engine |
|---------|-------------|-----------|
| Play Monday's schedule on Monday | Cron push at midnight | Automatic `schedule_date` switch |
| Plan 7 days ahead in DB | Autopilot fill | Same — autopilot fill |
| Nightly `.pls` push | **Required** | **Not needed** |

## What cron is still optional for

| Job | Purpose | Priority |
|-----|---------|----------|
| **Autopilot horizon refresh** | Keep next 7 empty days filled | Weekly or daily — **not** midnight playout switch |
| **Ingest retry** | Re-pack failed videos | Low — worker polls already |
| **Backup / metrics** | Postgres dump, log rotate | Ops standard |

**Decision: pause nightly playout-switch cron.** Revisit only if we add an external CDN origin that requires pre-published manifests (not current architecture).

## Autopilot API (manual or scheduled)

```bash
POST /v1/channels/:id/autopilot/generate
{"days": 7, "from_date": "2026-06-06"}
```

Optional future endpoint: `POST /v1/cron/autopilot` (protected, Tailscale-only) to refresh empty days — **not** for day rollover.
