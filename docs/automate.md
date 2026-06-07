# EWATV — automation & agentic AI evaluation

How EWATV scheduling and playout can evolve with **rules-based automation today** and **agentic AI teams tomorrow**.

**Status:** Evaluation / roadmap (2026-06-02)  
**Related:** [User manual](./usermanual.md), [Enterprise roadmap](../ewatv-playout-backend/docs/ENTERPRISE_ROADMAP.md)

---

## Executive summary

| Layer | Today | Near-term | Agentic AI |
|-------|-------|-----------|------------|
| **Weekly fill** | Autopilot (daypart + empty days) | Rights windows, genre mix rules | Traffic agent proposes week → human approves |
| **Daily ops** | Manual save + playout toggle | Cron horizon refresh only (Go) | Ops agent monitors gaps/errors, files tickets |
| **Break structure** | Fixed gap + NEXT card | SCTE-35 markers | Ad ops agent inserts pods from yield model |
| **Library** | Manual URL ingest | MAM webhook | Ingest agent normalizes metadata + QC |
| **Compliance** | None | As-run export | Compliance agent vs schedule diff |

EWATV already separates **schedule truth (Postgres)** from **playout execution (Go engine)** — ideal for agents that **propose JSON patches** rather than touching FFmpeg directly.

---

## 1. Current automation (shipped)

### 1.1 Weekly autopilot

**What it does**

- Rolling **7-day** horizon per channel
- Fills **only empty** calendar days
- Selects videos by **daypart** (`primetime`, `night`, `any`) and duration fit
- Writes `schedule_items` with `source_snapshot`

**Triggers**

| Mode | Trigger |
|------|---------|
| Go standalone | Manual **Run autopilot** or `POST /v1/channels/:id/autopilot/generate` |
| Supabase + Mist | Same UI + hourly cron at `autopilot_push_hour` |

**Files:** `ewatv-playout-backend/internal/schedule/autopilot.go`, `src/lib/schedule/autopilot*.ts`

### 1.2 Playout engine (no human push)

Go engine (`internal/playout/engine.go`):

- 500 ms tick per active channel
- Reloads schedule when **calendar date** changes (timezone-aware)
- Builds sliding-window HLS from pre-segmented CMAF
- Computes **now-playing** for overlays

**Automation win:** Eliminates nightly Mist `.pls` push for day rollover.

### 1.3 Save → air path

| Mode | On Save |
|------|---------|
| Go | Persist items; engine picks up within one tick |
| Mist | Persist + push today if `playout_active` |

---

## 2. Near-term automation (no AI required)

Priority enhancements a corp traffic system expects:

| Feature | Benefit | Effort |
|---------|---------|--------|
| **EPG API** `GET /v1/epg?channel=&from=&to=` | FAST platforms, TV guide apps | Medium |
| **As-run logs** | Ad sales, compliance | Medium |
| **Rights windows** on videos | Block expired assets in autopilot | Low |
| **Approval workflow** | Draft schedule → publish | Medium |
| **Live break-in** | `priority` flag overrides timeline | Medium |
| **Horizon cron (Go only)** | `POST /v1/cron/autopilot` @ 04:00 — fill week, no push | Low |
| **MAM ingest webhook** | `{ video_id, url }` from Dalet/Viz | Medium |
| **SCTE-35 in HLS** | Ad pod markers for SSAI | High |

These are deterministic — suitable for traditional traffic systems integration.

---

## 3. Agentic AI — architecture pattern

### 3.1 Design principle

```text
┌──────────────┐     propose      ┌──────────────┐     commit      ┌──────────┐
│ Agent team   │ ───────────────► │ Staging JSON │ ───────────────► │ Postgres │
│ (read-only   │   schedule patch │ + diff view  │   human or      │ schedules│
│  API access) │                  │ in admin UI  │   policy gate   │          │
└──────────────┘                  └──────────────┘                 └──────────┘
                                         │
                                         ▼
                                  Go playout engine
                                  (unchanged)
```

**Agents never:**

- Execute arbitrary FFmpeg
- Push directly to Mist/production without gate
- Bypass JWT auth or RLS

**Agents may:**

- Read library + existing schedules + EPG gap analysis
- Propose `schedule_items[]` patches or autopilot rule changes
- Open PR-style **Schedule Proposal** records for operator approval

### 3.2 Suggested agent roles

| Agent | Inputs | Outputs | Human gate |
|-------|--------|---------|------------|
| **Traffic planner** | Library metadata, daypart, target hours/day | 7-day draft schedules | Traffic manager approve |
| **Gap filler** | Today's timeline vs 24h target | List of videos to insert | One-click apply |
| **Brand compliance** | Overlay rules, sponsor separation | Flag overlapping promos | Legal review |
| **Ops monitor** | `/metrics`, ingest failures, empty HLS | Slack/email incident | Auto-remediate slate only |
| **Ingest QC** | ffprobe results, loudness, black frames | Accept/reject + metadata fix | Library manager |
| **Ad traffic** | Yield rules, pod length | SCTE-35 cue list | Ad ops approve |

### 3.3 Implementation options

| Approach | Pros | Cons |
|----------|------|------|
| **Cursor / Cloud Agents on repo** | Fast to prototype rules in Go/TS | Not runtime |
| **Scheduled LLM job + REST** | Calls `/v1/*` with service account | Needs proposal API |
| **n8n / Temporal workflow** | Visual ops, retries | Extra infra |
| **Dedicated `ewatv-agent` service** | Clean audit log | New deployable |

**Recommended first slice:** Traffic planner agent that outputs a **JSON schedule proposal** consumed by a new admin UI panel “Review AI suggestion”.

---

## 4. Agentic workflows (concrete scenarios)

### 4.1 Monday morning week fill

1. **Trigger:** Cron Monday 06:00 or traffic clicks “AI plan week”.
2. **Agent reads:** Last 4 weeks as-run (when available), library deltas, holidays calendar.
3. **Agent writes:** `schedule_proposals` row with 7× `schedule_items` per channel.
4. **UI:** Side-by-side diff vs current empty days.
5. **Operator:** Approve all / per-day / reject.
6. **Backend:** Merge approved items → existing `saveSchedule` path.

### 4.2 Breaking news interrupt

1. **Trigger:** Webhook from CMS “breaking: {video_id, duration}”.
2. **Ops agent** inserts high-`priority` item at `now()` via API.
3. Engine discontinuity at next segment boundary (already supported in HLS).
4. **Post-event:** Agent suggests gap fill to restore 24h block.

### 4.3 Library normalization

1. **Ingest agent** watches `ingest_jobs` failures.
2. Retries with alternate FFmpeg preset or flags corrupt masters.
3. Updates `title`, `category`, `daypart` from filename/EPG feed.

### 4.4 Multi-channel FAST portfolio

1. **Portfolio agent** balances genre mix across `news`, `kids`, `movies`.
2. Ensures no duplicate premieres same hour.
3. Outputs coordinated autopilot config patches per channel.

---

## 5. API extensions for agents

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/epg` | Read horizon for planning |
| `GET /v1/as-run?date=` | Historical truth for learning |
| `POST /v1/schedule-proposals` | Stage agent output |
| `POST /v1/schedule-proposals/:id/approve` | Commit to real schedule |
| `GET /v1/library/search?daypart=&min_sec=&max_sec=` | Structured library queries |
| Service account JWT | `role: agent` with write limited to proposals |

---

## 6. Risk matrix

| Risk | Mitigation |
|------|------------|
| Hallucinated video IDs | Validate all IDs server-side before staging |
| Overlong programs | Enforce 24h cap + conflict detection (exists) |
| Rights violations | `valid_until` hard block in autopilot |
| Runaway API cost | Batch planning weekly, cache library snapshot |
| On-air surprise | **No auto-approve** for within-next-2-hours changes |

---

## 7. Phased roadmap

| Phase | Deliverable | Agent involvement |
|-------|-------------|-------------------|
| **A** | EPG + as-run APIs | None (data for future agents) |
| **B** | Schedule proposal table + UI diff | Human runs agent offline, paste JSON |
| **C** | Service account + `ewatv-agent` cron | Traffic planner weekly |
| **D** | Ops monitor + ingest QC | 24/7 agent team with alerting |
| **E** | Ad pod / SCTE agent | Revenue optimization |

---

## 8. What not to automate (yet)

- Live FFmpeg transcoding (stay pre-segmented)
- Direct agent access to production Postgres superuser
- Fully unattended approve for prime-time slots without as-run feedback loop

---

## Related files

| Path | Topic |
|------|-------|
| `ewatv-playout-backend/docs/SCHEDULE_AND_CRON.md` | Cron vs engine |
| `ewatv-playout-backend/docs/ENTERPRISE_ROADMAP.md` | Broadcast features |
| `.cursor/skills/ewatv-schedule-timeline/` | Schedule UI skill |
| `.cursor/skills/ewatv-autopilot-cron/` | Mist cron skill |
