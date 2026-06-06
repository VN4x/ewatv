# Podman deployment (AX42 / production)

Podman is used instead of Docker: rootless-friendly, lower daemon overhead, native systemd quadlets, built-in secrets.

## Quick start

```bash
cd ewatv-playout-backend

# 1. Create secrets (once)
./deployments/podman/scripts/create-secrets.sh

# 2. Start stack
podman compose -f deployments/podman/compose.yaml up -d

# 3. Verify
curl http://localhost:8090/health
curl http://localhost:8090/ready
```

## Stack services

| Service | Image | RAM (typical) | Role |
|---------|-------|---------------|------|
| `postgres` | postgres:16-alpine | ~40–80 MB | Standalone schedule + library DB |
| `redis` | redis:7-alpine | ~10–20 MB | Now-playing cache, ingest locks |
| `playout` | local Containerfile | ~50–150 MB | Go API + ingest worker |
| `adminer` | adminer:4 (profile `admin`) | ~15 MB | Optional DB UI |

**Why not full self-hosted Supabase?** Adds ~1 GB RAM (Kong, GoTrue, etc.). This backend includes its own auth + REST API — only Postgres is needed. Optional **Adminer** (`profile: admin`) for SQL UI.

**Why not PocketBase?** SQLite single-writer limits concurrent ingest + playout queries on multi-channel 24/7 workloads.

## Secrets

### Option A — Podman secrets (recommended on AX42)

```bash
./deployments/podman/scripts/create-secrets.sh
```

Creates:
- `ewatv_db_password`
- `ewatv_jwt_secret` — local playout JWT signing secret
- `ewatv_redis_password` (optional)

Secrets mount as files under `/run/secrets/` inside containers.

### Option B — Infisical (team secret store)

```bash
# Install infisical CLI, login, then:
infisical run --env=production -- \
  podman compose -f deployments/podman/compose.yaml up -d
```

Set in Infisical project `ewatv-playout`:
- `EWATV_DATABASE_URL`
- `EWATV_AUTH_SUPABASE_JWT_SECRET`
- `EWATV_REDIS_URL`

See `deployments/podman/infisical.env.example`.

## Systemd quadlets (24/7 on AX42)

```bash
sudo cp deployments/podman/quadlets/*.container /etc/containers/systemd/
sudo cp deployments/podman/quadlets/*.volume /etc/containers/systemd/
systemctl --user daemon-reload   # or sudo for system units
systemctl --user enable --now ewatv-postgres ewatv-redis ewatv-playout
```

Quadlets use the same images/volumes as compose; suitable for auto-start after reboot.

## Data volumes

| Volume | Mount | Content |
|--------|-------|---------|
| `ewatv_pgdata` | `/var/lib/postgresql/data` | Postgres |
| `ewatv_playout_data` | `/data` | Videos, CMAF segments, channel manifests |

On AX42: bind-mount NVMe for `/data` hot path, HDD for archive (see ARCHITECTURE.md).

## Local dev (Windows)

Clone/pull to `A:\001code\1 Cursor\ewatv` then:

```powershell
cd "A:\001code\1 Cursor\ewatv\ewatv-playout-backend"
podman compose -f deployments/podman/compose.yaml up postgres redis -d
go run ./cmd/server -config configs/config.example.yaml
```

Or use WSL2 with the same paths under `/mnt/a/001code/1 Cursor/ewatv/`.
