# ewatv autopilot cron

## Schedule: **hourly** (push hour configurable per channel in Settings)

Each channel has a configurable **Update hour** (0–23, default 4) in its
Settings page. The cron script runs every hour; the handler skips channels
whose configured hour doesn't match the current hour in `AUTOPILOT_TIMEZONE`
(default `Europe/Helsinki`).

### VPS crontab (recommended)

```cron
# Run every hour — handler picks the right channels for the current hour
CRON_TZ=Europe/Helsinki
0 * * * * /path/to/ewatv/deploy/cron/autopilot.sh >> /var/log/ewatv-autopilot.log 2>&1
```

Host not in Helsinki? Set `CRON_TZ=Europe/Helsinki` so the timezone matches.

### What runs each hour

For every channel where the configured **Update hour** equals the current hour:

1. Fill **empty** days in the rolling horizon (channel `autopilot_enabled`).
2. **Push today's** schedule to Mist when `playout_active`.

Manual **Update now** in channel Settings or **Save** on Schedules still
pushes immediately, regardless of the hour.

### Env for `autopilot.sh`

```bash
export EWATV_APP_URL=https://your-app.lovable.app
export AUTOPILOT_CRON_SECRET=your-secret
```

Lovable secrets must include the same `AUTOPILOT_CRON_SECRET` and
`SUPABASE_SERVICE_ROLE_KEY` (used by `/api/cron/autopilot`).
