# EWATV Standalone Playout — Zero External Dependencies

Deploy on **any machine** (AX42, VPS, laptop) with only:

- Podman (or bare metal Go binary)
- Postgres 16
- Redis 7
- FFmpeg

**No Lovable. No hosted Supabase. No Mist.**

## 5-minute bootstrap

```bash
cd ewatv-playout-backend

# 1. Database + cache
make podman-dev
make migrate   # runs 001 + 002 if needed; or both auto-run on first postgres start

# 2. Run backend
export EWATV_AUTH_JWT_SECRET="dev-secret-min-32-chars-long!!"
make run

# 3. Create admin account
curl -s -X POST http://localhost:8090/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ewatv.local","password":"changeme123","display_name":"Admin"}' | jq .

# Save the returned token:
export TOKEN="eyJ..."

# 4. Create channel
curl -s -X POST http://localhost:8090/v1/channels \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Main","slug":"main","playout_active":true}' | jq .

# 5. Add video (ingest pulls URL + packs CMAF)
curl -s -X POST http://localhost:8090/v1/videos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test clip","source_type":"direct_url","source_ref":"https://example.com/video.mp4"}' | jq .

# 6. Generate week schedule
CHANNEL_ID="..." # from step 4
curl -s -X POST "http://localhost:8090/v1/channels/$CHANNEL_ID/autopilot/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"days":7}' | jq .

# 7. Watch linear stream
curl -s http://localhost:8090/v1/channels/main/now-playing | jq .
open http://localhost:8090/hls/main/index.m3u8   # VLC / browser + hls.js
```

## API surface (complete)

| Area | Endpoints |
|------|-----------|
| **Auth** | `POST /v1/auth/register`, `POST /v1/auth/login`, `GET /v1/auth/me` |
| **Collections** | CRUD `/v1/collections` |
| **Videos** | CRUD `/v1/videos`, `POST .../reingest` |
| **Channels** | CRUD `/v1/channels` |
| **Schedules** | `GET/PUT /v1/channels/:id/schedules/:date`, list by channel |
| **Autopilot** | `POST /v1/channels/:id/autopilot/generate` |
| **Playout** | `GET /v1/channels/:slug/now-playing` (public) |
| **Streaming** | `GET /hls/:slug/index.m3u8`, segment files (public) |
| **Ops** | `GET /health`, `GET /ready`, `GET /metrics` |

OpenAPI: `api/openapi.yaml`

## Windows local path

```powershell
cd "A:\001code\1 Cursor\ewatv\ewatv-playout-backend"
git pull
make podman-dev
make run
```

See [LOCAL_SYNC.md](./LOCAL_SYNC.md).

## Frontend integration (optional)

Point any React/hls.js player at:

```env
VITE_PLAYOUT_API=http://localhost:8090
VITE_PLAYOUT_HLS_BASE=http://localhost:8090/hls
```

Replace Supabase calls with REST to this backend using the JWT from `/v1/auth/login`.

## Production (AX42 + Podman secrets)

```bash
make secrets    # local JWT secret + DB credentials
make podman-up
```

Set `playout.public_base_url` to your public HTTPS origin in config.
