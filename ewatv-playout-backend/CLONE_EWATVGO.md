# Clone to Windows — ewatvGO standalone stack

Target directory on your machine:

```text
A:\001code\1 Cursor\ewatvGO
```

## First-time clone

```powershell
cd "A:\001code\1 Cursor"
git clone https://github.com/VN4x/ewatv.git "1 Cursor\ewatvGO"
cd "1 Cursor\ewatvGO"
git checkout cursor/ewatv-playout-backend-foundation-7aef
```

After merge to `main`:

```powershell
git checkout main
git pull origin main
```

## Configure frontend → Go backend

Create or edit `.env` in the repo root:

```env
VITE_DATA_SOURCE=playout
VITE_PLAYOUT_API=http://localhost:8090
VITE_PLAYOUT_HLS_BASE=http://localhost:8090/hls
EWATV_AUTH_JWT_SECRET=dev-secret-min-32-chars-long!!
```

## Install & run

```powershell
# Terminal 1 — Go backend
cd "A:\001code\1 Cursor\ewatvGO\ewatv-playout-backend"
podman compose -f deployments/podman/compose.dev.yaml up -d
go run ./cmd/server -config configs/config.example.yaml

# Terminal 2 — React admin UI
cd "A:\001code\1 Cursor\ewatvGO"
npm install
npm run dev
```

Open http://localhost:8080 → register → Collections / Schedules / Playout.

HLS test: http://localhost:8090/hls/{channel-slug}/index.m3u8 (master ABR playlist).

## Update existing clone

```powershell
cd "A:\001code\1 Cursor\ewatvGO"
git pull
```

## Production (AX42)

See `ewatv-playout-backend/deployments/podman/tailscale/README.md` and run:

```bash
sudo ./ewatv-playout-backend/deployments/podman/scripts/install-quadlets.sh
```
