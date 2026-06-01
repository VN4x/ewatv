#!/usr/bin/env bash
# Daily autopilot @ 04:00 air timezone (before early viewers).
# - Fills rolling 7-day schedule in Postgres (empty days only)
# - Pushes TODAY to Mist (playout_active channels)
#
# Crontab example (see deploy/cron/README.md):
#   CRON_TZ=Europe/Helsinki
#   0 4 * * * /path/to/deploy/cron/autopilot.sh >> /var/log/ewatv-autopilot.log 2>&1

set -euo pipefail

APP_URL="${EWATV_APP_URL:-https://your-lovable-app.lovable.app}"
SECRET="${AUTOPILOT_CRON_SECRET:?Set AUTOPILOT_CRON_SECRET}"

echo "ewatv autopilot starting at $(date -Is) (target: daily push before early viewers)"

curl -fsS -X POST "${APP_URL}/api/cron/autopilot" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "X-Cron-Secret: ${SECRET}" \
  --data '{"secret":"'"${SECRET}"'"}' \
  | tee -a /tmp/ewatv-autopilot-last.json

echo ""
echo "autopilot cron OK at $(date -Is)"
