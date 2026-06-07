# EWATV — analytics evaluation

Options for **viewer analytics**, **operations dashboards**, and **broadcast metrics** on top of the current EWATV stack.

**Status:** Evaluation (2026-06-02) — **not implemented**  
**Related:** [Enterprise roadmap](../ewatv-playout-backend/docs/ENTERPRISE_ROADMAP.md), [Test report](./test-report.md)

---

## Executive summary

EWATV today has **strong playout foundations** but **no audience analytics product**:

| Capability | Status |
|------------|--------|
| Concurrent viewers | ✅ Live API + dashboard |
| Watch time / minutes | ✅ Session heartbeats |
| Geography / region | ✅ CF-IPCountry header (when present) |
| Time-of-day / day-of-week graphs | ✅ `/analytics` UI |
| As-run (what actually aired) | ✅ Engine + API |
| EPG (planned grid) | ⚠️ Data in DB, no grid API |
| Ops metrics (Prometheus custom) | ⚠️ Default Go metrics only |

**Recommendation:** Build a **Phase 1 ops + audience MVP** on Go backend + Postgres, fronted by **Grafana** (ops) and a **React analytics page** (business users).

---

## 1. Metrics a TV corporation expects

### 1.1 Audience (sales & programming)

| Metric | Definition | Typical use |
|--------|------------|-------------|
| **Concurrent viewers** | Unique sessions watching now | Capacity, SLA |
| **Peak concurrent** | Max CCV in interval | Infrastructure sizing |
| **Total viewing minutes** | Σ session duration | Ad pricing |
| **Avg watch time** | Minutes / unique viewer | Content engagement |
| **Unique viewers** | Distinct session IDs per day | Reach |
| **Geography** | Country/region from IP or CDN | Rights, ad targeting |
| **Device / platform** | Web, embedded, OTT app | Product decisions |
| **Time of day** | CCV or minutes by hour | Scheduling |
| **Day of week** | CCV or minutes by weekday | Traffic planning |
| **Channel share** | % minutes per channel | Multi-channel FAST |
| **Completion rate** | Watched / program duration | Programming QC |

### 1.2 Broadcast operations

| Metric | Definition |
|--------|------------|
| **As-run log** | Immutable aired events (title, start, end, source) |
| **Schedule vs as-run variance** | Late start, skipped item |
| **Playout health** | Engine tick errors, gap slate % |
| **Ingest queue** | Jobs pending/failed |
| **CDN bandwidth** | Egress Mbps per channel |

### 1.3 Advertising (future)

| Metric | Definition |
|--------|------------|
| **Impressions** | Ad pod views (SCTE-35 aligned) |
| **Fill rate** | Served / requested pods |
| **QoE** | Rebuffer ratio, startup time, bitrate switches |

---

## 2. Current system — what exists

### 2.1 Data sources (usable)

| Source | Location | Analytics value |
|--------|----------|-----------------|
| `schedule_items` | Postgres | **Planned** EPG |
| `playout_state` | Postgres | **Live** item cursor (overwritten) |
| Go request logs | Zerolog middleware | Raw HLS hits (not aggregated) |
| `/metrics` | Go Prometheus | Process CPU/mem only |
| `now-playing` polls | Client 3s interval | Could proxy interest (misleading) |
| Caddy JSON logs | Podman deploy | Access log pipeline possible |

### 2.2 Documented but not built

- Redis viewer counts (`ARCHITECTURE.md` — Redis only used for health ping)
- `video_segments` table (architecture only)
- Audience analytics Tier 2 in `ENTERPRISE_ROADMAP.md`

### 2.3 Frontend

- No GA, PostHog, or custom beacon
- hls.js errors stay local (no QoE pipeline)

---

## 3. Recommended architecture

```text
                    ┌─────────────────────────────────────┐
                    │  Viewer (embed / playout page)       │
                    │  hls.js + session heartbeat beacon   │
                    └──────────────────┬──────────────────┘
                                       │ POST /v1/events/heartbeat
                                       ▼
┌──────────────┐   segment GET    ┌─────────────────────────────┐
│ CDN (opt.)   │ ◄─────────────── │ Go playout origin            │
│ access logs  │                  │ + event ingest middleware    │
└──────┬───────┘                  └───────────┬─────────────────┘
       │                                      │
       │            ┌─────────────────────────┼─────────────────┐
       │            ▼                         ▼                 ▼
       │     watch_sessions            as_run_events      Prometheus
       │     (Postgres)                (Postgres)         (custom metrics)
       │            │                         │
       └────────────┴────► ETL / rollups ◄────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Grafana          React            Export
         (ops)         /analytics         (CSV/Parquet)
```

---

## 4. Phase 1 — MVP (4–6 engineering slices)

### 4.1 Session heartbeat (client)

**Implementation**

- On player mount: `POST /v1/events/session-start` → `{ sessionId, channelSlug, userAgent }`
- Every 30s: `POST /v1/events/heartbeat` → `{ sessionId, positionMs?, bitrate? }`
- On unload: `sendBeacon` session-end

**Privacy:** No PII; hash IP server-side; GDPR retention policy (90 days default).

**Files to touch:** `LinearPlayer.tsx`, new `internal/analytics/` handler.

### 4.2 Postgres schema

```sql
-- Illustrative
CREATE TABLE watch_sessions (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  country_code CHAR(2),
  region_code TEXT,
  user_agent_hash TEXT,
  total_watch_ms BIGINT DEFAULT 0
);

CREATE TABLE as_run_events (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL,
  schedule_item_id UUID,
  video_id UUID,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  title TEXT,
  UNIQUE (channel_id, started_at)
);
```

Engine writes **as_run** on item transition (extend `engine.go` tick).

### 4.3 Aggregations (hourly cron)

Materialized rollups:

| Table | Dimensions |
|-------|------------|
| `analytics_hourly` | channel, date, hour → ccv_peak, minutes, uniques |
| `analytics_dow` | channel, day_of_week → minutes |

Or use **TimescaleDB** extension on AX42 Postgres.

### 4.4 API for dashboard

| Endpoint | Returns |
|----------|---------|
| `GET /v1/analytics/live` | Current CCV per channel |
| `GET /v1/analytics/summary?from=&to=` | Minutes, uniques, peak |
| `GET /v1/analytics/by-hour?channel=` | Time-of-day series |
| `GET /v1/analytics/by-dow?channel=` | Day-of-week series |
| `GET /v1/analytics/geo?channel=` | Country breakdown |

JWT + `role: analyst` or admin.

### 4.5 Admin UI — `/analytics`

React page (reuse TanStack + Recharts already in `package.json`):

- **Live tile:** CCV now (all channels)
- **Line chart:** CCV by hour (last 24h / 7d)
- **Bar chart:** Minutes by day of week
- **Map/table:** Top regions
- **Table:** Channel comparison

### 4.6 Ops — Grafana

- Scrape Go `/metrics` with custom counters:
  - `ewatv_playout_active_channels`
  - `ewatv_hls_segment_requests_total{channel,variant}`
  - `ewatv_ingest_jobs_failed_total`
- VictoriaMetrics on AX42 (per `ARCHITECTURE.md`)

---

## 5. Phase 2 — CDN + advanced QoE

| Source | Metrics |
|--------|---------|
| **Cloudflare / Bunny logs** | True edge CCV, bandwidth, geo |
| **hls.js QoE events** | Startup time, rebuffer count, dropped frames |
| **SSAI partner** | Ad impressions |

**Challenge:** CDN CCV ≠ origin CCV; dedupe with session cookies or JWT on manifest.

---

## 6. Phase 3 — Enterprise / Nielsen

| Feature | Notes |
|---------|-------|
| Nielsen / Comscore SDK | Separate player build or watermark |
| As-run export to ad ops | CSV/AXF daily |
| SLA dashboard | 99.9% playout uptime |
| Multi-tenant org dashboards | Per-brand ACL |

---

## 7. Option comparison

| Approach | Pros | Cons | Fit |
|----------|------|------|-----|
| **First-party Postgres** | Full control, no vendor lock | Build charts yourself | ✅ Recommended MVP |
| **PostHog / GA4** | Fast web analytics | Weak linear/CCV semantics | Embed page only |
| **CDN analytics alone** | Accurate bandwidth/geo | Miss watch time, gaps | Combine with Phase 1 |
| **MistServer stats** | Built-in if on Mist | Not in Go path | Legacy mode only |
| **Datadog / Grafana Cloud** | Ops maturity | Cost at scale | Ops metrics |

---

## 8. Dashboard wireframe (proposed)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Analytics — Live                          Last updated: 12:04  │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│ CCV now 187 │ Today 4.2k  │ Minutes     │ Peak today 312        │
│             │ uniques     │ 28,400      │ @ 20:00               │
├─────────────┴─────────────┴─────────────┴───────────────────────┤
│  Concurrent viewers (24h)          │  Minutes by day of week    │
│  [line chart by hour]              │  [bar Mon–Sun]             │
├────────────────────────────────────┴──────────────────────────┤
│  By region (table)          │  By channel (table)               │
│  FI 45%  SE 22%  …          │  news 62%  kids 38%               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Effort estimate (technical slices)

| Slice | Components | Depends on |
|-------|------------|------------|
| Session beacon + API | Frontend + Go handler | — |
| `watch_sessions` + rollups | Migration + cron | Beacon |
| As-run writer | Engine hook | — |
| `/v1/analytics/*` | Handlers + SQL | Rollups |
| `/analytics` UI | React route + charts | API |
| Grafana dashboards | JSON + scrape config | Custom Prometheus |
| GeoIP | MaxMind or CDN headers | Beacon |

---

## 10. Privacy & compliance

- Document retention in privacy policy
- IP → country only (truncate IP at ingest)
- Opt-out for EU if required (don't set cookie until consent)
- Admin analytics route requires auth; no public stats API

---

## 11. Immediate next step

1. **As-run table + engine hook** — enables programming compliance before audience metrics.
2. **Heartbeat beacon** — unlocks CCV and minutes.
3. **Single Grafana board** — ops confidence while UI catches up.

See [Automate](./automate.md) for agent-driven anomaly detection on top of these series.

---

## File index

| Path | Relevance |
|------|-----------|
| `ewatv-playout-backend/internal/playout/engine.go` | As-run hook point |
| `ewatv-playout-backend/internal/stream/hls.go` | Segment request metrics |
| `ewatv-playout-backend/internal/server/app.go` | `/metrics` registration |
| `src/components/playout/LinearPlayer.tsx` | QoE/beacon hook point |
| `src/hooks/useNowPlaying.ts` | Poll interval reference |
| `ewatv-playout-backend/docs/ENTERPRISE_ROADMAP.md` | Tier 2 audience analytics |
