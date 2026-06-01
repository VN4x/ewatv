#!/usr/bin/env bash
# Example cron: daily autopilot (generate tomorrow + push today).
# Install on VPS or use GitHub Actions scheduled workflow.
#
# Crontab (05:00 Europe/Helsinki — adjust for host TZ):
#   0 5 * * * /path/to/deploy/cron/autopilot.sh >> /var/log/ewatv-autopilot.log 2>&1

set -euo pipefail

APP_URL="${EWATV_APP_URL:-https://your-lovable-app.lovable.app}"
SECRET="${AUTOPILOT_CRON_SECRET:?Set AUTOPILOT_CRON_SECRET}"

curl -fsS -X POST "${APP_URL}/api/cron/autopilot" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "X-Cron-Secret: ${SECRET}" \
  --data '{"secret":"'"${SECRET}"'"}' \
  | tee -a /tmp/ewatv-autopilot-last.json

echo ""
echo "autopilot cron OK at $(date -Is)"
