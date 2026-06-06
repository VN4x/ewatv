# Local sync — Windows dev path

Your canonical clone path:

```text
A:\001code\1 Cursor\ewatv\
└── ewatv-playout-backend\    ← Go backend (this folder)
```

## Pull latest from GitHub

```powershell
cd "A:\001code\1 Cursor\ewatv"
git pull origin cursor/ewatv-playout-backend-foundation-7aef
# or after merge: git pull origin main
```

## Run on Windows with Podman Desktop

```powershell
cd "A:\001code\1 Cursor\ewatv\ewatv-playout-backend"
podman compose -f deployments/podman/compose.dev.yaml up -d
go run ./cmd/server -config configs/config.example.yaml
```

Set Supabase JWT secret for auth (same as hosted project **Settings → API → JWT Secret**):

```powershell
$env:EWATV_AUTH_SUPABASE_JWT_SECRET = "your-jwt-secret"
$env:EWATV_AUTH_REQUIRE_AUTH = "false"   # optional: disable auth for local API testing
```

## WSL2 alternative

```bash
cd "/mnt/a/001code/1 Cursor/ewatv/ewatv-playout-backend"
make podman-dev && make run
```

Cloud Agent pushes to GitHub; you pull to `A:\` — no automatic sync to local disk from the VM.
