# ewatv autopilot cron

## Schedule: **04:00** (air timezone)

Early viewers start before 05:00. Run the autopilot job at **04:00 or earlier** in `AUTOPILOT_TIMEZONE` (default `Europe/Helsinki`).

### VPS crontab (recommended)

```cron
# Run at 04:00 Helsinki — generates rolling week + pushes TODAY to Mist
CRON_TZ=Europe/Helsinki
0 4 * * * /path/to/ewatv/deploy/cron/autopilot.sh >> /var/log/ewatv-autopilot.log 2>&1
```

Host not in Helsinki? Set `CRON_TZ=Europe/Helsinki` so `0 4` means 04:00 **Helsinki**, not host local time.

### What runs at 04:00

1. Fill **empty** days in the 7-day horizon (channel `autopilot_enabled`).
2. **Push today’s** schedule to Mist for channels with **`playout_active`** (updates the live HLS stream before morning audience).

Manual **Save** on Schedules still pushes today immediately when Playout active (not limited to 04:00).

### Env for `autopilot.sh`

```bash
export EWATV_APP_URL=https://your-app.lovable.app
export AUTOPILOT_CRON_SECRET=your-secret
```

Lovable secrets must include the same `AUTOPILOT_CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` (used by `/api/cron/autopilot`).
