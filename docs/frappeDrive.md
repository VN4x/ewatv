# Frappe Drive — storage & playout evaluation for EWATV

**Status:** Evaluation (2026-06-02) — not a recommendation to adopt for playout  
**Scope:** Self-hosted Frappe Drive as **media storage** and/or **linear playout service**, with focus on upstream `VideoPreview.vue`  
**Related:** [Architecture discussion](./ewatv-architecture-discussion-2026-06-02.md), Go playout backend (PR #4), [production plan](./production-plan.md) (feature branch)

---

## Executive summary

| Question | Answer |
|----------|--------|
| Good **storage** for mezzanine / library files? | **Yes**, with operational overhead (second stack) |
| Good **playout service** for 24/7 linear HLS? | **No** |
| Faster **viewer** experience vs pre-segmented HLS + CDN? | **No** |
| Better **on-air quality** (ABR, mobile, scale)? | **No** |
| Fast self-hosted server helps **operator preview**? | **Yes** |
| Reuse `VideoPreview.vue` in EWATV? | **No** for playout; **pattern only** for library VOD preview |

**Recommendation:** Do **not** route EWATV playout through Frappe Drive. Keep linear delivery on the Go playout backend (pre-segmented CMAF HLS + hls.js) or, in legacy mode, Mist + hls.js. Consider Drive only as an optional **DAM / upload portal** if operators need general file collaboration outside EWATV — and even then, treat it as ingest **source**, not playout **origin**.

---

## What Frappe Drive is

[Frappe Drive](https://github.com/frappe/drive) is an AGPLv3 self-hosted file storage and collaboration app built on the **Frappe Framework** (Python). It targets Google Drive–style workflows: folders, sharing, permissions, guest users, office/PDF preview, multipart upload, optional **S3** backend, activity logs.

It is **not** a broadcast playout system. There is no schedule engine, no multi-channel linear manifest rotation, no as-run logging, no autopilot, and no adaptive HLS ladder for viewers.

### Official video capabilities

From [Frappe Drive previews documentation](https://docs.frappe.io/drive/previews):

> **Frappe Drive lacks any transcoding pipeline for now** so only H264, H265*, and AV1* codecs are supported for video streaming.

Supported MIME types for in-browser preview:

- `video/mp4`
- `video/webm`
- `video/quicktime`

**FFmpeg** is a system dependency (thumbnails, tooling) — not a broadcast ingest/ABR pipeline. Third-party blog posts describing “native HLS” overstate the product; upstream code and docs align on **HTTP Range progressive streaming** of already-compatible files, not `.m3u8` linear playout.

### Self-hosted stack cost

Production self-host typically requires:

- Frappe Framework (Python)
- MariaDB or PostgreSQL
- Redis + background workers
- `ffmpeg`, `libmagic`
- Reverse proxy (TLS)
- Backup strategy (Drive docs warn not to rely on the app as sole storage)

That is a **second operational stack** alongside EWATV’s Go + Podman + Postgres path.

---

## How Frappe Drive streams video (backend)

Video preview uses **`stream_file_content`** in `drive/api/files.py` (upstream `frappe/drive`, `develop` branch).

Flow:

1. Client sends request with **`Range`** header (browser `<video>` seeking/scrubbing).
2. If no `Range`, falls back to full file download path.
3. Server parses byte range, caps chunk at **20 MB** per response.
4. Reads bytes from local disk or **S3** (via `FileManager`).
5. Returns **HTTP 206 Partial Content** with `Content-Range`.

Conceptually:

```text
Browser <video>  --Range: bytes=0-...-->  Frappe (Python)
                                              |
                                              v
                                         disk or S3
                                         (single MP4/WebM)
```

There is **no**:

- HLS master/variant playlist generation
- CMAF/fMP4 segment packaging for ABR
- Schedule-based manifest stitching
- CDN-friendly immutable segment URLs
- Live transcode or `-re` playout loop

---

## `VideoPreview.vue` — detailed usability review

**Path (upstream):** `frontend/src/components/FileTypePreview/VideoPreview.vue`  
**Repo:** https://github.com/frappe/drive  
**Note:** This file is **not** in the EWATV repository; it belongs to Drive’s Vue 3 admin UI.

### Template behavior

```vue
<template>
  <LoadingIndicator v-show="loading" class="w-10" />
  <video
    v-show="!loading"
    :key="src"
    ref="mediaRef"
    class="max-h-[70vh] max-w-full rounded-lg"
    autoplay
    muted
    preload="none"
    controlslist="nodownload noremoteplayback noplaybackrate disablepictureinpicture"
    controls
    draggable="false"
    @loadedmetadata="handleMediaReady"
  >
    <source :src="src" :type="type" />
  </video>
</template>
```

### Script behavior

| Aspect | Implementation |
|--------|----------------|
| **Source URL** | `/api/method/drive.api.files.stream_file_content?entity_name={id}` |
| **Player** | Native HTML5 `<video>` — **no hls.js**, no Shaka, no MSE pipeline |
| **MIME** | Maps `video/quicktime` → `video/mp4` |
| **Loading UX** | Spinner until `readyState === 1` (metadata loaded) |
| **Lifecycle** | Resets `src` on entity change and unmount |

### Inline technical debt (from source comments)

Developers note:

- Codec evaluation **assumes** valid H.264/H.265 in MP4/WebM.
- **MP4 with `moov` atom at end** causes slow start; client-side fragmentation (GPAC MP4Box) is listed as future work.
- **“Server side byte is good enough for now”** — confirms VOD preview scope, not broadcast playout.

### Usability matrix for EWATV

| Use case | `VideoPreview.vue` fit | Notes |
|----------|--------------------------|-------|
| In-Drive file preview | ✅ Good | Simple, appropriate for DAM UI |
| EWATV **linear** playout viewer | ❌ Wrong | Needs HLS + schedule sync + ABR |
| EWATV **library** mezzanine scrub | ⚠️ Pattern only | Reimplement in React against Go Range API |
| Drop into React/TanStack app | ❌ | Vue + Frappe session/API coupling |
| Embed / FAST partner player | ❌ | No adaptive bitrate, no linear clock |
| Reference for `LinearPlayer` | ❌ | EWATV already uses hls.js correctly |

### EWATV equivalent (playout)

EWATV linear viewing uses **`LinearPlayer`** (`src/components/playout/LinearPlayer.tsx`):

- **hls.js** with low-latency settings
- Loads `/hls/{slug}/index.m3u8` (Go backend or Mist legacy)
- Stall detection, reload handle, optional YouTube fallback

That is the correct model for **24/7 linear HLS**. `VideoPreview.vue` solves a different problem: **single-file VOD preview inside a file manager**.

---

## Storage evaluation

### Strengths as storage / DAM

| Feature | Benefit for EWATV |
|---------|-------------------|
| Multipart + folder upload | Large mezzanine ingest without custom UI |
| Pooled / per-user quotas | Ops control on AX42 disk |
| S3 backend | Cold archive on bulk HDD or object store |
| Permissions + guest links | External producer upload without EWATV accounts |
| Activity log | Audit trail for compliance |
| Full-text search | Find assets by name/content |

### Weaknesses as EWATV primary library

| Gap | Impact |
|-----|--------|
| No link to `schedule_items` / channels | Extra sync layer required |
| No ingest job / CMAF pack status | EWATV Go worker still required after upload |
| No duration probe API for scheduling | Still need ffprobe in Go |
| Duplicate metadata store | Frappe DB + EWATV Postgres |
| AGPLv3 | Compliance review if SaaS/multi-tenant |

### Verdict — storage

**Usable as optional ingest source or team file portal**, not as replacement for EWATV’s library DB + `/data` layout. If adopted, treat Drive as **upstream bucket**: file lands in Drive → webhook or poll → EWATV `POST /v1/videos` + ingest job pulls URL/path.

---

## Playout evaluation

EWATV playout requirements (Go backend design):

| Requirement | Frappe Drive | EWATV Go backend |
|-------------|--------------|------------------|
| Pre-segmented CMAF at ingest | ❌ | ✅ FFmpeg `PackABR` (720p/480p/360p) |
| Playout = manifest rotation | ❌ | ✅ Engine loop, no live transcode |
| Multi-channel 24/7 | ❌ | ✅ Per-channel runtime |
| Day rollover / autopilot | ❌ | ✅ Schedule + cron |
| ABR for mobile | ❌ | ✅ Master + variant playlists |
| CDN cache-friendly segments | ❌ | ✅ `Cache-Control: immutable` on `.m4s` |
| As-run / analytics | ❌ | ✅ Phase 1 on Go stack |
| Gap / slate handling | ❌ | ✅ Engine + player overlay |

### Verdict — playout

**Not suitable.** Routing viewers to Drive `stream_file_content` would mean:

- Progressive MP4 over Python Range reads (not HLS ABR)
- No adaptive quality on constrained mobile networks
- Poor scale beyond modest concurrent counts vs static segments + CDN
- No linear timeline — each viewer would watch a **file**, not a **channel**

---

## Would a powerful fast server help?

Assumption: AX42-class host (NVMe, 64 GB RAM, 1 Gbit) self-hosting Frappe Drive.

### Where speed **does** help

| Scenario | Why |
|----------|-----|
| Operator uploads | Fast disk + multipart → shorter ingest wait |
| Admin preview scrub | NVMe Range reads → responsive `<video>` seek |
| Large mezzanine library | S3/HDD tiering with hot metadata in DB |
| Concurrent **editors** previewing files | Better than cloud egress for internal team |

### Where speed **does not** help (vs current EWATV path)

| Scenario | Why Drive doesn’t win |
|----------|------------------------|
| 200+ **viewers** on linear channel | HLS segments + CDN beat per-request Python byte IO |
| **Mobile** viewers on variable networks | ABR ladder required; Drive has none |
| **Playout quality** | Quality set at ingest (CMAF pack), not at file-manager preview |
| **24/7 uptime** | Drive has no playout engine or gap recovery |
| **Start latency** on bad MP4s | moov-at-end files still painful without transcode/remux |

**Bottom line:** A fast server makes Drive **feel** fast for **one operator previewing one file**. It does not improve **broadcast playout quality** or **viewer-scale delivery** compared to EWATV’s pre-segmented HLS architecture.

---

## Comparison — delivery models

| Aspect | Frappe Drive (`VideoPreview.vue`) | EWATV linear (hls.js + Go) |
|--------|-----------------------------------|----------------------------|
| Protocol | HTTP 206 Range on single file | HLS (CMAF fMP4 segments) |
| Player | Native `<video>` | hls.js (+ Safari native HLS) |
| Transcoding | None | FFmpeg at ingest |
| Bitrate | Source file only | 720p / 480p / 360p ABR |
| Seek | Range requests | Segment boundary seek |
| Live linear | Not supported | Schedule-driven manifest |
| CDN | Whole-file or Range ( awkward ) | Immutable `.m4s` (ideal) |
| Ops stack | Frappe + DB + Redis + workers | Go + Postgres + Redis + Caddy |

---

## Architecture options

### A. Recommended — EWATV only (current production direction)

```text
Operators → React admin → Go API → FFmpeg ingest → CMAF on NVMe/HDD
Viewers   → hls.js (LinearPlayer) → /hls/{slug}/index.m3u8 → Caddy → CDN (Phase 3)
```

### B. Optional hybrid — Drive as DAM only

```text
Operators → Frappe Drive (upload / folders / share)
                │
                └── webhook or poll ──► Go ingest job ──► CMAF + schedule (unchanged)
Viewers   → still Go HLS only
```

### C. Avoid — Drive as playout origin

```text
Viewers → Frappe stream_file_content (Range MP4)   ← no ABR, no linear, poor scale
```

---

## Decision matrix

| Goal | Use Frappe Drive? |
|------|-------------------|
| Better linear HLS quality | ❌ No |
| Simpler production (one stack) | ❌ No — adds complexity |
| Team file portal + video preview | ✅ Maybe |
| Large upload UX without building UI | ✅ Maybe |
| Reuse `VideoPreview.vue` in EWATV playout | ❌ No |
| Library preview inside EWATV admin | ⚠️ Copy pattern to React + Go Range endpoint instead |

---

## Lighter alternative (no Frappe)

If the goal is **Drive-like preview** without operating Frappe:

Add to Go playout backend:

```http
GET /v1/videos/{id}/preview
Accept-Ranges: bytes
```

Serve mezzanine `source.mp4` with 206 Range support (same mechanism as Drive), or preview the **already-packed VOD HLS** from ingest. Implement in React on `/collections` or video detail — same UX intent as `VideoPreview.vue`, zero second stack.

---

## References

| Resource | URL |
|----------|-----|
| Frappe Drive repo | https://github.com/frappe/drive |
| Previews / codec limits | https://docs.frappe.io/drive/previews |
| `VideoPreview.vue` (develop) | https://github.com/frappe/drive/blob/develop/frontend/src/components/FileTypePreview/VideoPreview.vue |
| `stream_file_content` API | https://github.com/frappe/drive/blob/develop/drive/api/files.py |
| EWATV `LinearPlayer` | `src/components/playout/LinearPlayer.tsx` |
| Go HLS serving | `ewatv-playout-backend/internal/stream/hls.go` (PR #4) |

---

## Conclusion

Frappe Drive is a **capable self-hosted file collaboration product** with a **pragmatic VOD preview player** (`VideoPreview.vue` + Range streaming). It is **not** a playout service and would **not** improve EWATV’s on-air speed or quality versus pre-segmented CMAF HLS on a fast server.

**For EWATV:** keep playout on Go (or Mist legacy); optionally use Drive only as an external upload/DAM layer; do not adopt `VideoPreview.vue` for linear viewing — implement operator preview on the Go stack if needed.
