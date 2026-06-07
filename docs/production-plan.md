# EWATV — production readiness plan

**Stack decision:** Keep **React 19 + TanStack Start** admin, **Go playout backend**, **Podman + Caddy** on AX42.  
**Target:** Standalone playout mode (`VITE_DATA_SOURCE=playout`) as primary production path.  
**Date:** 2026-06-02

---

## 1. Production definition (done =)

| Criterion | Measure |
|-----------|---------|
| **Uptime** | 24/7 linear HLS per active channel; day rollover without manual push |
| **Ops** | One-command deploy, backups, health alerts, runbook |
| **Security** | TLS, JWT, secrets not in git, rate limits on public routes |
| **Operators** | Full admin on Go API: library → schedule → playout → analytics |
| **Viewers** | Embed + public playout; optional CDN for >200 CCV |
| **Compliance baseline** | As-run export, audit-friendly logs |

---

## 2. Current state (branch stack)

| Area | Status |
|------|--------|
| Go API, auth, ingest, ABR HLS, playout engine | ✅ PR #4 |
| Frontend playout-mode wiring | ✅ PR #5 |
| Docs (manual, quickstart, automate, analytics eval) | ✅ PR #6 |
| Analytics Phase 1 (sessions, as-run, dashboard) | ✅ PR #7 |
| Podman compose + quadlets + Tailscale docs | ✅ |
| CI/CD pipeline | ❌ |
| E2E tests | ❌ |
| Admin static/SSR production container | ❌ (Caddy block commented out) |
| Compose auto-migrate 002 + 003 | ❌ (only 001 in initdb) |
| EPG API, as-run export, custom Prometheus | ❌ |
| CDN integration | ❌ |
| Legacy Supabase/Mist path | ⚠️ Keep for migration only |

---

## 3. Additional frameworks & tools (not replacing React)

These **add** to the stack; they do not replace TanStack/React/hls.js.

### Required for production

| Tool | Role | Why |
|------|------|-----|
| **GitHub Actions** (or GitLab CI) | Lint, test, build, image push | No CI today |
| **Playwright** | E2E smoke (login → schedule → embed) | Catch regressions |
| **Caddy** | TLS, reverse proxy, static admin, HLS cache headers | Already in repo |
| **Podman + quadlets** | 24/7 services on AX42 | Already in repo |
| **pgBackRest** or **wal-g** | Postgres PITR backups | Data loss risk without |
| **VictoriaMetrics** or **Prometheus + Grafana** | Scrape `/metrics`, dashboards | Ops visibility |
| **Loki** or **Vector** + log ship | JSON logs from Go + Caddy | Incident response |

### Strongly recommended

| Tool | Role |
|------|------|
| **Bunny** or **Cloudflare** CDN | HLS segment caching; scale past ~200 CCV |
| **Trivy** / **grype** | Container image CVE scan in CI |
| **Infisical** or **Podman secrets** | JWT + DB passwords (scripts exist) |
| **Sentry** (optional) | Frontend + Go error tracking |
| **Uptime Kuma** or **Better Stack** | External `/ready` + HLS URL checks |

### Explicitly not needed (deferred)

| Tool | Reason |
|------|--------|
| Next.js / SvelteKit rewrite | Keep current admin |
| dash.js | HLS-only product decision |
| Full Supabase self-host | Standalone Postgres + Go auth |
| Kubernetes | Podman quadlets sufficient for AX42 |

### Frontend runtime in production

TanStack Start uses **Nitro SSR** today. Pick **one**:

| Option | Pros | Cons |
|--------|------|------|
| **A. SSR container** | Minimal frontend refactor; server fns work for legacy | Node process on AX42 |
| **B. Static SPA + Go only** | Simplest ops for playout mode | Remove/replace remaining `createServerFn` calls |

**Recommendation:** **Option B for playout production** — finish Go-only admin path, `npm run build`, serve `dist/client` from Caddy. Keep Option A only if you must run Supabase+Mist legacy in parallel.

---

## 4. Phased plan

### Phase 0 — Merge & baseline (blocking)

**Goal:** One reproducible production branch on `main`.

| Step | Scope | Owner |
|------|-------|-------|
| 0.1 | Merge PR #4 → #5 → #6 → #7 (or squash to `main`) | Eng |
| 0.2 | Fix Podman compose: run **002 + 003** migrations (init script or startup job) | Eng |
| 0.3 | Manual smoke on AX42: [test-report.md](./test-report.md) matrix rows 1–10 | Ops |
| 0.4 | Update `AGENTS.md` (playout no longer “placeholder”) | Eng |
| 0.5 | Production `.env` template: secrets, `EWATV_PLAYOUT_PUBLIC_BASE_URL`, domain | Ops |

**Exit:** Channel plays 24h with autopilot; admin works with `VITE_DATA_SOURCE=playout`.

---

### Phase 1 — Deploy & harden (production MVP)

**Goal:** Secure, monitored, backed-up stack on AX42.

| Step | Scope | Files / tools |
|------|-------|---------------|
| 1.1 | **Caddy production config**: TLS domain, `/hls/*` cache, `/v1/*`, rate limit | `deployments/podman/Caddyfile` |
| 1.2 | **Admin static deploy**: build frontend, mount in Caddy, env baked at build | Caddy `file_server`, CI build |
| 1.3 | **Quadlets on AX42**: postgres → redis → playout → caddy | `install-quadlets.sh` |
| 1.4 | **Tailscale** for admin + `/metrics`; public HLS/embed only | `tailscale/README.md` |
| 1.5 | **Backups**: nightly `pg_dump` + `/data` volume sync to HDD | cron on host |
| 1.6 | **Monitoring**: VictoriaMetrics scrape + Grafana dashboard (CPU, disk, `/ready`) | new `deploy/monitoring/` |
| 1.7 | **CI**: `npm run test`, `npm run build`, `go test ./...`, `go build`, Trivy | `.github/workflows/ci.yml` |
| 1.8 | **Playwright** smoke: login, create collection, save schedule, embed loads | `e2e/` + CI job |
| 1.9 | **Security**: enable rate limit on `/v1/events/*`, CSP on admin, rotate JWT | Go middleware, Caddy headers |
| 1.10 | **Runbook**: deploy, rollback, restore DB, disk full, ingest stuck | `docs/runbook.md` |

**Exit:** On-call can restore from backup; CI green; HTTPS live.

---

### Phase 2 — Product completeness (functional for TV corp)

**Goal:** Features operators expect before calling it “production linear.”

| Step | Scope | Priority |
|------|-------|----------|
| 2.1 | **EPG API** `GET /v1/epg?channel=&from=&to=` | P0 |
| 2.2 | **As-run export** daily JSON/CSV from `as_run_events` | P0 |
| 2.3 | **Go probe duration** — replace `probeVideoDuration` server fn in playout mode | P0 |
| 2.4 | **Overlay upload** — Go file upload endpoint (replace data-URL hack) | P1 |
| 2.5 | **Weekly autopilot cron** `POST /v1/cron/autopilot` (horizon fill only) | P1 |
| 2.6 | **OpenAPI** sync with actual routes | P1 |
| 2.7 | **Redis**: cache today’s schedule (doc promise) | P2 |
| 2.8 | **Custom Prometheus metrics**: CCV, segment requests, ingest queue | P2 |
| 2.9 | **Rights windows** on videos (`valid_until`) | P2 |
| 2.10 | **Roles**: admin vs operator vs analyst (JWT claims) | P2 |

**Frontend (same React stack):**

| Step | Scope |
|------|-------|
| 2.F1 | As-run view in `/analytics` or `/schedules` |
| 2.F2 | EPG preview page (optional public `/guide/:slug`) |
| 2.F3 | Ingest status polling on Collections (pack_progress) |
| 2.F4 | Error boundaries + toast for all `playoutApi` failures |

**Exit:** Traffic team can plan week, export what aired, demo EPG to FAST partner.

---

### Phase 3 — Scale & performance

**Goal:** 200+ concurrent viewers, headroom on AX42.

| Step | Scope |
|------|-------|
| 3.1 | **CDN** origin pull from Caddy; segment `Cache-Control: immutable` verified |
| 3.2 | **Separate admin hostname** (`admin.` tailnet-only) vs public `playout.` |
| 3.3 | **Load test** HLS (k6 or Locust) — validate 200 × 5 Mbps |
| 3.4 | **Disk lifecycle**: ingest queue limits, cold storage on 2 TB HDD |
| 3.5 | **Postgres tuning** + connection pool sizing under load |
| 3.6 | **Optional static embed** bundle (vanilla + hls.js) for partners |

**Exit:** CDN serves majority of bytes; origin CPU stable at target CCV.

---

### Phase 4 — Broadcast-grade (optional tier)

Defer until Phase 2 signed off by operations.

| Feature | Notes |
|---------|-------|
| SCTE-35 in HLS | Ad sales |
| WebVTT captions | Sidecar per video |
| Schedule approval workflow | Draft → publish |
| Live break-in | Priority schedule items |
| DR secondary node | Postgres replica + rsync |
| DASH | Only if partner requires `.mpd` |

See [automate.md](./automate.md) for agentic scheduling (Phase B+).

---

## 5. Scope boundaries

### In scope (production v1)

- Standalone Go + Postgres + Redis on AX42
- React admin (playout mode)
- Multi-channel HLS ABR
- Autopilot, analytics Phase 1
- Podman + Caddy + Tailscale
- CI + E2E smoke + backups + basic Grafana

### Out of scope (v1)

- Full Supabase/Lovable dependency for new deploys
- Mist VPS push (legacy only)
- DRM / SSAI / Nielsen
- Multi-tenant orgs
- Mobile native apps
- DASH

### Dual-mode policy

| Mode | Production use |
|------|----------------|
| `VITE_DATA_SOURCE=playout` | **Primary** — new AX42 deploys |
| Supabase + Mist | **Legacy** — maintain until migrated; no new features |

---

## 6. Dependency summary (production install)

```text
AX42 host
├── podman quadlets
│   ├── ewatv-postgres (+ pgBackRest cron on host)
│   ├── ewatv-redis
│   ├── ewatv-playout (Go binary)
│   └── ewatv-caddy (TLS, static admin, /hls, /v1 proxy)
├── tailscale (admin + metrics access)
├── grafana + victoriametrics (optional container or host)
└── backup cron → 2 TB HDD

Build/CI (GitHub)
├── npm: lint, test, build → static admin artifact
├── go: test, build → OCI image
├── playwright: smoke
└── trivy: scan image

CDN (optional Phase 3)
└── Bunny / Cloudflare → origin = Caddy /hls/*
```

**npm production dependencies (unchanged philosophy):** React, TanStack, hls.js, Recharts, Radix — bundled at build time, not installed on server.

---

## 7. Suggested merge & execution order

```text
1. Merge PR #4–#7 → main
2. Phase 0 smoke on staging AX42
3. Phase 1 in parallel tracks:
   ├── Infra (Caddy, quadlets, backups, monitoring)
   ├── CI/E2E
   └── Frontend static build pipeline
4. Phase 2 backend APIs (EPG, as-run export) + frontend surfaces
5. Phase 3 CDN + load test
6. Phase 4 as contract wins
```

---

## 8. Effort shape (technical, not calendar)

| Phase | Involvement | Risk |
|-------|-------------|------|
| 0 | Low | Low |
| 1 | Medium (infra + CI) | Medium — migrations, TLS, backups |
| 2 | Medium–high (API + UI) | Medium — EPG/as-run correctness |
| 3 | Medium (CDN/ops) | Low–medium |
| 4 | High per feature | High (broadcast specs) |

---

## 9. Related docs

| Doc | Use |
|-----|-----|
| [quickstart.md](./quickstart.md) | First channel |
| [usermanual.md](./usermanual.md) | Operator flows |
| [test-report.md](./test-report.md) | QA matrix |
| [analytics.md](./analytics.md) | Metrics shipped + roadmap |
| [automate.md](./automate.md) | Autopilot + AI |
| [FRONTEND_EVALUATION.md](../ewatv-playout-backend/docs/FRONTEND_EVALUATION.md) | Why keep React |
| [ENTERPRISE_ROADMAP.md](../ewatv-playout-backend/docs/ENTERPRISE_ROADMAP.md) | Tier 2–3 features |

---

## 10. Immediate next actions (this week)

1. **Merge** open PRs after smoke test.
2. **Add** `003_analytics.up.sql` + `002_standalone_auth.up.sql` to compose init/migrate.
3. **Create** `.github/workflows/ci.yml` (test + build).
4. **Enable** Caddy static admin + document build-time env in `quickstart.md`.
5. **Implement** EPG + as-run export (Phase 2 head start).
