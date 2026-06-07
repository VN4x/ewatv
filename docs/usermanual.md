# EWATV — user manual (TV corporation operators)

This manual describes how a **broadcast / FAST / OTT linear team** uses EWATV day to day: library management, scheduling, branding, and viewer delivery.

**Audience:** Playout operators, traffic/scheduling, master control, engineering liaisons.  
**Not covered:** Deep server administration (see `ewatv-playout-backend/STANDALONE.md`).

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Data flow](#2-data-flow)
3. [Roles and access](#3-roles-and-access)
4. [Action flows](#4-action-flows)
5. [Screens reference](#5-screens-reference)
6. [Deployment modes](#6-deployment-modes)
7. [Daily operations checklist](#7-daily-operations-checklist)
8. [Glossary](#8-glossary)

---

## 1. System overview

EWATV is a **linear TV control system**: you maintain a **video library**, build **24-hour schedules per channel**, and output a **continuous HLS stream** with **on-screen branding** (logos, NEXT card during gaps).

```text
┌─────────────────────────────────────────────────────────────────┐
│  ADMIN (browser)                                                 │
│  Collections │ Schedules │ Playout preview │ Settings            │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API (JWT)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE — Postgres                                        │
│  videos, collections, channels, schedules, schedule_items        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  PLAYOUT ENGINE (Go) OR MistServer (legacy)                      │
│  Reads today's timeline → serves /hls/{channel}/index.m3u8       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  VIEWERS — web embed, smart TV apps, CDN                         │
│  hls.js player + DB-driven overlays (not burned into video)      │
└─────────────────────────────────────────────────────────────────┘
```

**Key idea:** The schedule in the database is the **source of truth**. The stream is assembled from **pre-packaged segments** (no live transcoding at air time).

---

## 2. Data flow

### 2.1 Content library

```text
Collection (folder)
  └── Video
        ├── title, description, tags, daypart
        ├── source_ref (HTTPS URL to mezzanine file)
        └── after ingest → CMAF segments on disk (720p/480p/360p)
```

**Operator actions:** create folders, add videos by URL, edit metadata, delete.

**Ingest (automatic):** Backend downloads source, probes duration, FFmpeg packs fMP4 segments. Until `pack_status` is ready, video may not play cleanly on air.

### 2.2 Channel

```text
Channel
  ├── slug (URL: /playout/{slug}, /embed/{slug})
  ├── timezone (calendar day for "today")
  ├── overlays[] (logo positions, opacity)
  ├── fallback URL (YouTube if HLS fails)
  └── settings: gap duration, autopilot, playout_active
```

One channel = one linear HLS output. Multi-channel = multiple slugs (e.g. `news`, `kids`, `weather`).

### 2.3 Schedule

```text
Channel + calendar date (YYYY-MM-DD)
  └── Schedule
        └── schedule_items[] (ordered)
              ├── video_id → library asset
              ├── start_at, duration_ms, transition_ms (gap)
              └── source_snapshot (frozen metadata at save time)
```

**Gap / transition:** After each program, a **transition_ms** pause shows a **NEXT** card (upcoming title + time) over dimmed video + channel logos.

### 2.4 On air (today only)

| Store | Horizon |
|-------|---------|
| Postgres | Up to 7 days (autopilot fills empty days) |
| HLS engine | **Today's** items only, wall-clock aligned |

At each tick the engine finds the current item by `start_at` + duration, stitches the next N segment files into a live playlist, and exposes **now-playing** JSON for the player overlay.

---

## 3. Roles and access

| Role | Typical user | Access |
|------|--------------|--------|
| **Admin / operator** | Traffic, MCR | Full admin UI (login required) |
| **Viewer** | Public | `/playout/{slug}`, `/embed/{slug}` only |
| **API integrator** | Engineering | JWT + REST `/v1/*` |

Standalone mode: local users in Postgres (`POST /v1/auth/register`).  
Legacy mode: Supabase auth (email/password or Google via Lovable).

---

## 4. Action flows

### 4.1 Launch a new channel (greenfield)

| Step | Where | Action |
|------|-------|--------|
| 1 | **Settings → Create channel** | Name, slug, save |
| 2 | **Settings → channel** | Upload/paste logo URLs, set gap (seconds), fallback URL |
| 3 | **Settings → Embed** | Copy iframe snippet for website / FAST platform |
| 4 | **Collections** | Build library (see 4.2) |
| 5 | **Schedules** | Build first day, enable **Playout active** |
| 6 | **Playout** | Preview stream; share public URL |

### 4.2 Add content to library

| Step | Where | Action |
|------|-------|--------|
| 1 | **Collections** | Select or create folder |
| 2 | **Add video** | Title + **direct URL** to MP4 (720p H.264 recommended) |
| 3 | Wait | Ingest runs in background |
| 4 | Optional | Set daypart (`primetime`, `night`) for autopilot |
| 5 | Optional | **Hide overlay** if logo is burnt into master |

### 4.3 Build today's schedule (manual)

| Step | Where | Action |
|------|-------|--------|
| 1 | **Schedules** | Select channel + date |
| 2 | Set **Day start** time (usually 00:00 or chain from previous day) |
| 3 | **Add videos** | Multi-select from library |
| 4 | Drag rows | Reorder timeline |
| 5 | **Save** | Writes items + recomputed `start_at` |
| 6 | Enable **Playout active** | Starts HLS output |

**Tip:** Badge shows total duration — aim for ~24h or chain into next day with **Create**.

### 4.4 Weekly autopilot (traffic automation)

| Step | Where | Action |
|------|-------|--------|
| 1 | **Schedules** | Toggle **Autopilot weekly** ON |
| 2 | **Run autopilot** | Fills **empty** days in rolling 7-day window |
| 3 | Review each day | Autopilot picks by daypart; edit manually as needed |

Autopilot **does not overwrite** days that already have items.

**Go backend:** Engine switches to each day's schedule at midnight (channel TZ).  
**Mist legacy:** Cron must push **today's** playlist to VPS daily.

### 4.5 Branding / overlays

| Step | Where | Action |
|------|-------|--------|
| 1 | **Channel settings → Overlays** | Add logo image (URL or upload) |
| 2 | Position | Anchor (e.g. bottom-right), size %, opacity |
| 3 | Multiple overlays | Watermark + sponsor bug + corner logo |
| 4 | **Save settings** | Applies on next player poll (~3s) |

Overlays are **player-side** (HTML/CSS over `<video>`), not encoded into the stream.

### 4.6 Publish to end viewers

| Method | URL pattern | Use case |
|--------|-------------|----------|
| Public watch page | `/playout/{slug}` | Marketing site link |
| Embed iframe | `/embed/{slug}` | Partner sites, FAST wrappers |
| Raw HLS | `/hls/{slug}/index.m3u8` | Roku, Samsung TV, ExoPlayer, VLC |
| CDN | CNAME to origin | Scale beyond ~200 concurrent |

### 4.7 Handle stream failure

1. Player tries HLS (ABR: 720p → 480p → 360p).
2. On fatal error or 10s stall → **fallback URL** (often YouTube loop).
3. Operator checks **Playout** preview + backend logs.

---

## 5. Screens reference

| Screen | Path | Purpose |
|--------|------|---------|
| Collections | `/collections` | Library CRUD |
| Schedules | `/schedules` | Timeline editor, autopilot, playout toggle |
| Playout | `/playout` | Operator monitor (now/next, preview) |
| Settings | `/settings` | Channel list |
| Channel settings | `/channels/{slug}/settings` | Identity, overlays, embed, delete |
| Public player | `/playout/{slug}` | Full-screen viewer |
| Embed | `/embed/{slug}` | Muted autoplay iframe |

---

## 6. Deployment modes

| | **Standalone (recommended)** | **Legacy Supabase + Mist** |
|--|------------------------------|----------------------------|
| Config | `VITE_DATA_SOURCE=playout` | Default Supabase env |
| Database | Your Postgres (AX42) | Lovable Cloud Supabase |
| Playout | Go engine | MistServer VPS |
| Day rollover | Automatic | Cron + Mist push |
| Docs | `ewatv-playout-backend/STANDALONE.md` | `deploy/mist/README.md` |

Corporations standardizing on **self-hosted** should use standalone mode.

---

## 7. Daily operations checklist

### Master control (start of day)

- [ ] Confirm **Playout active** on all live channels
- [ ] Spot-check **Playout** preview (audio/video/logo)
- [ ] Verify today's schedule row count and total hours
- [ ] Confirm no ingest failures on today's items

### Traffic (weekly)

- [ ] Run **autopilot** after library updates
- [ ] Review empty days in horizon
- [ ] Manual polish for holidays / specials

### Engineering (as needed)

- [ ] Disk space on segment volume
- [ ] `/ready` and `/metrics` (if monitored)
- [ ] CDN cache hit ratio for `.m4s` segments

---

## 8. Glossary

| Term | Meaning |
|------|---------|
| **ABR** | Adaptive bitrate (720p/480p/360p ladders) |
| **Autopilot** | Auto-fill empty schedule days from library rules |
| **CMAF / fMP4** | Segment format used for HLS |
| **Gap / transition** | Interstitial between programs (NEXT card) |
| **HLS** | HTTP Live Streaming (`.m3u8` + segments) |
| **Now-playing** | API JSON for current/next title + overlay config |
| **Playout active** | Channel is outputting HLS |
| **Slug** | URL-safe channel id (e.g. `news`) |

---

## Related documentation

- [Quickstart](./quickstart.md)
- [Test report](./test-report.md)
- [Automate — AI scheduling](./automate.md)
- [Analytics roadmap](./analytics.md)
- [Architecture discussion](./ewatv-architecture-discussion-2026-06-02.md)
