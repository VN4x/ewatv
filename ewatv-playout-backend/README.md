# EWATV Linear Playout Backend

Go + Fiber linear TV playout engine for **Hetzner AX42**, replacing Strimm/Mist with pre-segmented HLS/DASH. Integrates with the [ewatv frontend](https://github.com/VN4x/ewatv).

**Local Windows path:** `A:\001code\1 Cursor\ewatv\ewatv-playout-backend` — see [LOCAL_SYNC.md](./LOCAL_SYNC.md).

## Confirmed architecture decisions

| Decision | Choice |
|----------|--------|
| Database | **Standalone Postgres 16** on AX42 (not PocketBase; optional Adminer UI) |
| Auth | **Supabase JWT** validation (same tokens as frontend login) |
| Ingest | **Pull `source_ref` URL** → local NVMe → FFmpeg CMAF pack |
| Containers | **Podman** + quadlets + podman secrets (GNU) or Infisical |

## Quick start (dev)

```bash
# Postgres + Redis (no secrets)
make podman-dev

# Backend
go mod tidy
export EWATV_AUTH_REQUIRE_AUTH=false   # local API testing
make run

curl http://localhost:8090/health
curl http://localhost:8090/ready
```

## Production (AX42 + Podman secrets)

```bash
make secrets          # creates ewatv_db_password, ewatv_jwt_secret, ewatv_database_url
make podman-up
```

See [deployments/podman/README.md](./deployments/podman/README.md).

## API (Phase 2)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/videos` | JWT | List library |
| POST | `/v1/videos` | JWT | Add video + queue ingest |
| GET | `/v1/videos/:id` | — | Get video |
| PATCH | `/v1/videos/:id` | JWT | Update metadata |
| DELETE | `/v1/videos/:id` | JWT | Delete |
| POST | `/v1/videos/:id/reingest` | JWT | Re-download + re-pack |

Create video example:

```bash
curl -X POST http://localhost:8090/v1/videos \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Episode 1","source_type":"direct_url","source_ref":"https://example.com/ep1.mp4"}'
```

## Project layout

```text
ewatv-playout-backend/
├── cmd/server/
├── internal/
│   ├── auth/           # Supabase JWT
│   ├── ingest/         # Download, ffprobe, FFmpeg CMAF worker
│   ├── library/        # Video CRUD + ingest queue
│   ├── handlers/
│   └── ...
├── deployments/podman/ # Compose, quadlets, secrets scripts
├── migrations/
└── api/openapi.yaml
```

## Frontend integration

```env
VITE_PLAYOUT_HLS_BASE=https://playout.yourdomain.com/hls
```

`LinearPlayer` + `nowPlaying` overlays unchanged.

## Status

| Phase | Module | Status |
|-------|--------|--------|
| 1 | Platform foundation | ✅ |
| 2 | Video library + ingest | ✅ |
| 3 | Schedule API | 🔜 |
| 4 | Playout engine + HLS/DASH | 🔜 |
| 5 | WebSocket now-playing | 🔜 |
| 6 | Frontend adapter | 🔜 |

## License

Same as ewatv parent project.
