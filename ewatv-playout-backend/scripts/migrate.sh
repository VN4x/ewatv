#!/usr/bin/env bash
# Apply all SQL migrations in order (dev / bare-metal).
set -euo pipefail
DB_URL="${EWATV_DATABASE_URL:-postgres://ewatv:ewatv@localhost:5433/ewatv_playout?sslmode=disable}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/migrations"
for f in "$DIR"/*.up.sql; do
  echo "==> $f"
  psql "$DB_URL" -f "$f"
done
