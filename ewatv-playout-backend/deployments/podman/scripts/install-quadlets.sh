#!/usr/bin/env bash
# Install EWATV Podman quadlets on AX42 (system-wide, starts on boot).
# Run as root on Hetzner host with Podman 4.4+ and systemd.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
QUADLET_SRC="$REPO_ROOT/deployments/podman/quadlets"
SYSTEMD_DIR="/etc/containers/systemd"
CADDY_DIR="/etc/ewatv"

echo "=== EWATV quadlet install ==="

if ! command -v podman &>/dev/null; then
  echo "Error: podman not found" >&2
  exit 1
fi

# Secrets must exist before start
if ! podman secret inspect ewatv_jwt_secret &>/dev/null; then
  echo "Run $REPO_ROOT/deployments/podman/scripts/create-secrets.sh first"
  exit 1
fi

mkdir -p "$SYSTEMD_DIR" "$CADDY_DIR"
cp -v "$QUADLET_SRC"/*.container "$QUADLET_SRC"/*.volume "$QUADLET_SRC"/*.network "$SYSTEMD_DIR/"
cp -v "$REPO_ROOT/deployments/podman/Caddyfile" "$CADDY_DIR/Caddyfile"

# Patch Caddyfile path in quadlet (relative ./Caddyfile does not work in systemd)
sed -i "s|Volume=./Caddyfile:|Volume=$CADDY_DIR/Caddyfile:|" "$SYSTEMD_DIR/ewatv-caddy.container"

# Build playout image locally
echo "Building playout image..."
podman build -t localhost/ewatv-playout:latest -f "$REPO_ROOT/deployments/podman/Containerfile" "$REPO_ROOT"

systemctl daemon-reload

echo ""
echo "Enable services:"
echo "  systemctl enable --now ewatv-network.service"
echo "  systemctl enable --now ewatv-postgres.service ewatv-redis.service"
echo "  systemctl enable --now ewatv-playout.service ewatv-caddy.service"
echo ""
echo "Set EWATV_DOMAIN in $SYSTEMD_DIR/ewatv-caddy.container (Tailscale MagicDNS name)"
echo "Set EWATV_PLAYOUT_PUBLIC_BASE_URL in ewatv-playout.container to match"
