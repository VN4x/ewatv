# EWATV — quickstart

Get a linear channel on air in **under 30 minutes** (standalone Go path — recommended for TV ops on own hardware).

---

## What you need

| Item | Notes |
|------|-------|
| Machine | Linux with Podman (AX42, VPS, or dev PC) |
| FFmpeg | On PATH (ingest packaging) |
| Browser | Chrome/Firefox for admin UI |
| Optional CDN | Bunny/Cloudflare in front of HLS for >200 viewers |

---

## 1. Clone and branch

```powershell
git clone https://github.com/VN4x/ewatv.git "A:\001code\1 Cursor\ewatvGO"
cd ewatvGO
git checkout cursor/finish-playout-frontend-tests-7aef
```

See also `ewatv-playout-backend/CLONE_EWATVGO.md`.

---

## 2. Start backend (Postgres + Redis + Go)

```bash
cd ewatv-playout-backend
make podman-dev    # Postgres 16 + Redis 7
make migrate
export EWATV_AUTH_JWT_SECRET="dev-secret-min-32-chars-long!!"
make run           # listens :8090
```

Verify:

```bash
curl -s http://localhost:8090/health
curl -s http://localhost:8090/ready
```

---

## 3. Create admin account (API)

```bash
curl -s -X POST http://localhost:8090/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ops@tv.corp","password":"changeme123","display_name":"Ops"}' | jq .
```

Save the `token` for curl, or use the UI in step 4.

---

## 4. Start admin UI (playout mode)

Repo root `.env` or `.env.local`:

```env
VITE_DATA_SOURCE=playout
VITE_PLAYOUT_API=http://localhost:8090
VITE_PLAYOUT_HLS_BASE=http://localhost:8090/hls
```

```bash
cd ..   # repo root
npm install
npm run dev
```

Open **http://localhost:8080/login** → sign in with `ops@tv.corp`.

---

## 5. Five-minute content path

| Step | UI | Action |
|------|-----|--------|
| 1 | **Settings → Create channel** | Name `News`, slug `news`, save overlays |
| 2 | **Collections** | Create folder, add video (paste HTTPS MP4 URL) |
| 3 | Wait ~1–5 min | Ingest packs CMAF segments (check video list) |
| 4 | **Schedules** | Pick channel, today’s date, **Add videos**, **Save** |
| 5 | Toggle **Playout active** | Engine serves HLS |
| 6 | **Playout** or `/playout/news` | Confirm stream + logo |

HLS URL for VLC:

```text
http://localhost:8090/hls/news/index.m3u8
```

---

## 6. Publish to viewers

| Surface | URL |
|---------|-----|
| Public page | `https://your-domain/playout/news` |
| Embed iframe | Settings → Embed → copy HTML snippet |
| Direct HLS | `https://playout.your-domain/hls/news/index.m3u8` |

Production: deploy Podman quadlets + Caddy — `ewatv-playout-backend/deployments/podman/README.md`.

---

## 7. Weekly autopilot (optional)

**Schedules** → enable **Autopilot weekly** → **Run autopilot**.

Fills **7 empty calendar days** from your library (daypart rules). The Go engine auto-loads each day at midnight in channel timezone — **no nightly cron required**.

---

## Legacy path (Supabase + Mist)

If you stay on Lovable Cloud + Mist VPS:

1. Omit `VITE_DATA_SOURCE=playout`
2. Configure `.env` Supabase + `VITE_MIST_HLS_BASE`
3. Deploy `deploy/mist/` and hourly cron `deploy/cron/README.md`

See [User manual](./usermanual.md) for both modes.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login fails | Check `EWATV_AUTH_JWT_SECRET` matches backend |
| Black player | `playout_active` on? Schedule has items today? Video ingested? |
| 404 on HLS | Channel slug must match URL; engine only runs active channels |
| CORS errors | Serve UI and API behind same Caddy host in prod |

---

## Next reads

- [User manual](./usermanual.md) — full operator workflows
- [Test report](./test-report.md) — QA status
- [Automate](./automate.md) — AI-assisted scheduling roadmap
- [Analytics](./analytics.md) — viewer metrics roadmap
