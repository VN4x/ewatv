#!/usr/bin/env bash
# Create Podman secrets for ewatv-playout stack.
# Run once per host. Requires podman >= 4.4 with secret support.
set -euo pipefail

create_secret() {
  local name="$1"
  local prompt="$2"
  if podman secret inspect "$name" &>/dev/null; then
    echo "Secret $name already exists — skip (podman secret rm $name to recreate)"
    return
  fi
  read -rsp "$prompt: " val
  echo
  printf '%s' "$val" | podman secret create "$name" -
  echo "Created secret: $name"
}

echo "=== EWATV Podman secrets ==="
create_secret ewatv_db_password "Postgres password"
create_secret ewatv_jwt_secret "Supabase JWT secret (Settings → API → JWT Secret)"

if ! podman secret inspect ewatv_database_url &>/dev/null; then
  read -rsp "Postgres password (again, for connection URL): " dbpw
  echo
  printf 'postgres://ewatv:%s@postgres:5432/ewatv_playout?sslmode=disable' "$dbpw" | \
    podman secret create ewatv_database_url -
  echo "Created secret: ewatv_database_url"
else
  echo "Secret ewatv_database_url already exists — skip"
fi
echo
echo "Optional Redis password (Enter to skip):"
read -rsp "Redis password: " redis_pw
echo
if [[ -n "${redis_pw}" ]]; then
  if podman secret inspect ewatv_redis_password &>/dev/null; then
    echo "Secret ewatv_redis_password already exists — skip"
  else
    printf '%s' "$redis_pw" | podman secret create ewatv_redis_password -
    echo "Created secret: ewatv_redis_password"
  fi
fi
echo "Done. Start stack: podman compose -f deployments/podman/compose.yaml up -d"
