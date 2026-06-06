# Local sync — Windows dev path

Your canonical clone path:

```text
A:\001code\1 Cursor\ewatv\
└── ewatv-playout-backend\    ← Go backend (standalone, no Supabase)
```

## Pull latest from GitHub

```powershell
cd "A:\001code\1 Cursor\ewatv"
git pull origin main
```

## Run on Windows with Podman Desktop

```powershell
cd "A:\001code\1 Cursor\ewatv\ewatv-playout-backend"
podman compose -f deployments/podman/compose.dev.yaml up -d
$env:EWATV_AUTH_JWT_SECRET = "dev-secret-min-32-chars-long!!"
go run ./cmd/server -config configs/config.example.yaml
```

Register first user — see [STANDALONE.md](./STANDALONE.md).

Cloud Agent pushes to GitHub; pull to `A:\` manually.
