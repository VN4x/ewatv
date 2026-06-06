# EWATV Linear Playout Backend

**Fully standalone** Go + Fiber linear TV engine. Deploy on any machine with Postgres + Redis + FFmpeg — no Lovable, no Supabase, no Mist.

**Local path:** `A:\001code\1 Cursor\ewatv\ewatv-playout-backend`

## Quick start

See **[STANDALONE.md](./STANDALONE.md)** for the full bootstrap (register → channel → video → autopilot → HLS).

```bash
make podman-dev && make run
```

## Stack

| Component | Choice |
|-----------|--------|
| Runtime | Go 1.22 + Fiber |
| Database | Postgres 16 (standalone on AX42) |
| Cache | Redis 7 |
| Containers | **Podman** + quadlets + secrets |
| Auth | Local JWT (bcrypt users in Postgres) |
| Streaming | HLS (CMAF fMP4, pre-segmented) |

## Status

| Phase | Module | Status |
|-------|--------|--------|
| 1 | Platform foundation | ✅ |
| 2 | Video library + ingest | ✅ |
| 3 | Collections, channels, schedules | ✅ |
| 4 | Autopilot + playout engine + HLS | ✅ |
| 5 | DASH, WebSocket, cron | 🔜 |
| 6 | Frontend API client package | ✅ |

## Docs

- [STANDALONE.md](./STANDALONE.md) — zero-dependency deploy guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design
- [deployments/podman/README.md](./deployments/podman/README.md) — production Podman
- [LOCAL_SYNC.md](./LOCAL_SYNC.md) — Windows sync

## License

Same as ewatv parent project.
