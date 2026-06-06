# EWATV Linear Playout Backend

Go + Fiber linear TV playout engine for **Hetzner AX42**, designed to replace Strimm/Mist with pre-segmented HLS/DASH and tight integration with the [ewatv frontend](https://github.com/VN4x/ewatv).

## Quick start (local)

```bash
# 1. Start Postgres + Redis
docker compose -f deployments/docker/docker-compose.yml up postgres redis -d

# 2. Install deps & run
cd ewatv-playout-backend
go mod tidy
make run

# 3. Verify
curl http://localhost:8090/health
curl http://localhost:8090/ready
```

## Project layout

```text
ewatv-playout-backend/
├── cmd/server/           # Entrypoint
├── internal/
│   ├── api/              # HTTP handlers (Phase 2+)
│   ├── config/           # Viper configuration
│   ├── database/         # Postgres + Redis
│   ├── handlers/         # Health, metrics
│   ├── middleware/       # CORS, JWT, rate limit, logging
│   ├── models/           # Domain types (Video, Schedule, Channel)
│   ├── platform/         # Logger, lifecycle
│   └── server/           # Fiber app wiring
├── migrations/           # SQL schema
├── api/openapi.yaml      # API contract
├── deployments/docker/   # Docker Compose + Dockerfile
└── ARCHITECTURE.md       # Full design doc
```

## Frontend integration

Set in ewatv `.env`:

```env
VITE_PLAYOUT_HLS_BASE=https://playout.yourdomain.com/hls
```

The existing `LinearPlayer` + `nowPlaying` overlay flow stays unchanged; only the HLS origin moves from Mist to this backend.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module roadmap, AX42 tuning, and phased migration.

## Configuration

Copy `configs/config.example.yaml` and override via env (`EWATV_*` prefix):

| Env | Config key |
|-----|------------|
| `EWATV_DATABASE_URL` | `database.url` |
| `EWATV_REDIS_URL` | `redis.url` |
| `EWATV_AUTH_JWT_SECRET` | `auth.jwt_secret` |
| `EWATV_SERVER_PORT` | `server.port` |

## Status

**Foundation (v0.1.0)** — health/ready/metrics, config, DB models, migrations.

| Phase | Module | Status |
|-------|--------|--------|
| 1 | Platform foundation | ✅ |
| 2 | Video library + ingest | 🔜 |
| 3 | Schedule API | 🔜 |
| 4 | Playout engine + HLS/DASH | 🔜 |
| 5 | WebSocket now-playing | 🔜 |
| 6 | Frontend adapter | 🔜 |

## License

Same as ewatv parent project.
