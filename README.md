# EWATV

Self-hosted **linear TV playout** for broadcast, FAST, and OTT operators: video library, multi-channel schedules, 24/7 HLS with adaptive bitrate, and browser-based branding overlays.

---

## Two deployment modes

| Mode | Best for | Playout |
|------|----------|---------|
| **Standalone (Go)** | TV corp on own hardware (AX42, VPS) | `ewatv-playout-backend` — no Supabase, no Mist |
| **Legacy (Supabase + Mist)** | Lovable Cloud control plane + VPS Mist | MistServer `.pls` push + cron |

**Recommended for new deployments:** standalone Go path with `VITE_DATA_SOURCE=playout`.

---

## Documentation

| Doc | Audience |
|-----|----------|
| **[Quickstart](./docs/quickstart.md)** | Get a channel on air in 30 minutes |
| **[User manual](./docs/usermanual.md)** | Operators — workflows, data flow, daily checklist |
| **[Test report](./docs/test-report.md)** | QA status and manual smoke matrix |
| **[Automate](./docs/automate.md)** | Scheduling automation + agentic AI roadmap |
| **[Analytics](./docs/analytics.md)** | Viewer metrics & dashboard (Phase 1 shipped) |

### Backend (Go)

| Doc | Topic |
|-----|-------|
| [STANDALONE.md](./ewatv-playout-backend/STANDALONE.md) | Deploy Postgres + Redis + playout |
| [ARCHITECTURE.md](./ewatv-playout-backend/ARCHITECTURE.md) | System design |
| [CLONE_EWATVGO.md](./ewatv-playout-backend/CLONE_EWATVGO.md) | Windows clone path |
| [Podman deploy](./ewatv-playout-backend/deployments/podman/README.md) | Production quadlets + Caddy |

### Legacy (Mist)

| Doc | Topic |
|-----|-------|
| [deploy/mist/README.md](./deploy/mist/README.md) | MistServer stack |
| [deploy/cron/README.md](./deploy/cron/README.md) | Hourly autopilot + Mist push |

---

## Quick start (standalone)

```bash
# Backend
cd ewatv-playout-backend && make podman-dev && make migrate && make run

# Frontend (repo root)
cp .env.example .env   # VITE_DATA_SOURCE=playout
npm install && npm run dev
# → http://localhost:8080
```

Full steps: **[docs/quickstart.md](./docs/quickstart.md)**

---

## Stack

| Layer | Technology |
|-------|------------|
| Admin UI | TanStack Start, React 19, hls.js |
| Playout API | Go 1.22, Fiber, JWT |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Streaming | HLS (CMAF fMP4), ABR 720p/480p/360p |
| Deploy | Podman, Caddy, Tailscale |

---

## Development

```bash
npm run dev      # Admin UI (:8080 in Cloud VM)
npm run test     # Vitest unit tests
npm run build    # Production client + SSR

cd ewatv-playout-backend && go test ./...
```

Cloud agent notes: [AGENTS.md](./AGENTS.md)

---

## Pull requests

| PR | Scope |
|----|-------|
| [#4](https://github.com/VN4x/ewatv/pull/4) | Go playout backend foundation |
| [#5](https://github.com/VN4x/ewatv/pull/5) | Playout-mode frontend + unit tests |

---

## License

Same as parent ewatv project.
