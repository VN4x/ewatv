# EWATV — test report

**Date:** 2026-06-02  
**Branch:** `cursor/finish-playout-frontend-tests-7aef` (includes PR #5 frontend wiring)  
**Environment:** Cursor Cloud VM — Linux, Node 22+, Go 1.22+

---

## Executive summary

| Area | Result | Notes |
|------|--------|-------|
| Frontend unit tests (Vitest) | **9/9 pass** | Settings, API client, search sanitization |
| Go backend unit tests | **3 packages pass** | Auth, channel settings, HLS manifest |
| Production build (`npm run build`) | **Pass** | Client + SSR bundle |
| Go compile (`go build ./cmd/server`) | **Pass** (implicit via `go test`) | — |
| E2E browser / Playwright | **Not run** | No E2E harness in repo yet |
| Manual HLS playback | **Not run** | Requires live Postgres + ingest on VM |

**Verdict:** Core logic and build pipeline are green. Production validation still needs a manual smoke test with Go backend + browser on a real channel with ingested video.

---

## Automated test runs

### Frontend — `npm run test`

```
Test Files  3 passed (3)
Tests       9 passed (9)
Duration    ~330ms
```

| File | Tests | Coverage |
|------|-------|----------|
| `src/lib/data/search.test.ts` | 3 | `sanitizeSearch()` — wildcards, length cap |
| `src/lib/channels/settings.test.ts` | 3 | `parseChannelPlayoutSettings`, `mergePlayoutIntoSettings` |
| `src/lib/playout-backend/client.test.ts` | 3 | URL scheme guard, HTTP errors, JSON parse |

**Command:** `npm run test`  
**Config:** `vitest.config.ts` (Node environment)

### Go backend — `go test ./...`

| Package | Status | Tests |
|---------|--------|-------|
| `internal/auth` | ok | Password hash + verify |
| `internal/channels` | ok | Playout settings parse + merge |
| `internal/playout` | ok | HLS manifest render, master ABR list |

**Command:** `cd ewatv-playout-backend && go test ./... -count=1`

### Build

| Command | Result |
|---------|--------|
| `npm run build` | Success (~7s) |
| `npm run lint` | Not executed (known Prettier debt on `main`) |

---

## Manual test matrix (recommended before production)

Use this checklist on AX42 or local `ewatvGO` clone after merge.

### Standalone Go mode (`VITE_DATA_SOURCE=playout`)

| # | Step | Expected |
|---|------|----------|
| 1 | `make podman-dev && make migrate && make run` | `/health` 200, `/ready` 200 |
| 2 | `POST /v1/auth/register` | JWT returned |
| 3 | Create channel via UI Settings | Appears in Schedules picker |
| 4 | Add collection + video (URL ingest) | `pack_status` → ready |
| 5 | Build today's schedule, Save | Items persisted |
| 6 | Toggle **Playout active** | Engine tick starts |
| 7 | Open `/playout/{slug}` | HLS plays, overlay visible |
| 8 | Open `/embed/{slug}` | Autoplay muted iframe works |
| 9 | Run autopilot (7 days) | Empty days filled |
| 10 | Change calendar day (or wait midnight TZ) | Engine reloads schedule without cron |

### Legacy Supabase + Mist mode

| # | Step | Expected |
|---|------|----------|
| 1 | Login via Supabase | Collections load |
| 2 | Save schedule + playout active | Mist push or skip reason logged |
| 3 | Cron `/api/cron/autopilot` | Weekly fill + today push |

---

## Security checks (code review + unit)

| Check | Status |
|-------|--------|
| Playout API base URL restricted to http/https | ✅ `client.test.ts` |
| Search query wildcard stripping | ✅ `search.test.ts` |
| JWT required on admin `/v1/*` routes | ✅ Go middleware |
| Public routes: HLS + now-playing only | ✅ |
| Overlay upload playout mode: type + 512 KB cap | ✅ `upload.ts` |
| Rate limiting on manifests | ⚙️ Config exists, default off |
| HTTPS/TLS at edge | ⚙️ Caddy quadlet (deploy) |

---

## Known gaps (not failures — missing coverage)

1. **No integration tests** against real Postgres/Redis.
2. **No HLS conformance** automated check (DASH-IF / stream validator).
3. **No load test** for 200 concurrent viewers (AX42 sizing assumption).
4. **No visual regression** on Schedules drag-and-drop UI.
5. **Lint/format** not enforced in CI.

---

## Regression history (this release)

| PR | Focus |
|----|-------|
| [#4](https://github.com/VN4x/ewatv/pull/4) | Go playout backend, ABR HLS, Podman |
| [#5](https://github.com/VN4x/ewatv/pull/5) | Playout-mode frontend wiring + first unit tests |

---

## How to re-run

```bash
# Frontend
npm install
npm run test
npm run build

# Backend
cd ewatv-playout-backend
go test ./... -count=1
go build -o /tmp/ewatv-playout ./cmd/server
```

---

## Sign-off recommendation

- **Merge PR #5** after reviewer confirms manual smoke (rows 1–8 above).
- Add Playwright smoke for login → schedule save → embed load as next test milestone.
