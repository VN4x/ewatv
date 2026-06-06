# DASH implementation — evaluation & steps

**Status:** deferred (HLS-only ships today)  
**Target:** `GET /dash/{slug}/manifest.mpd` per [ARCHITECTURE.md](../ARCHITECTURE.md)  
**Last evaluated:** 2026-06-02 against branch `cursor/ewatv-playout-backend-foundation-7aef`

---

## Executive summary

| Question | Answer |
|----------|--------|
| **Worth doing now?** | **No** for EWATV’s primary web/mobile stack — hls.js + Safari native HLS already cover the product player. |
| **Hard part?** | Live **MPD generation** (Periods, AdaptationSets, SegmentTimeline) mirroring the existing HLS sliding window — not re-encoding. |
| **Reuse from HLS?** | **High** — same CMAF fMP4 segments (`init.mp4`, `w*.m4s`), same playout engine tick, same live dirs per rendition. |
| **Incremental effort** | ~300–500 LOC backend + Caddy route; optional ~100 LOC frontend if dash.js is added. |
| **Risk** | Schedule **discontinuities** (gap → program → gap) are harder in DASH than HLS `#EXT-X-DISCONTINUITY`. |

**Recommendation:** Ship **EPG + as-run + ABR HLS** first (see [ENTERPRISE_ROADMAP.md](./ENTERPRISE_ROADMAP.md)). Add DASH when a concrete client requires it (Android TV app on ExoPlayer-only, broadcast partner spec, FAST platform ingest).

---

## Current state (what already helps DASH)

### Ingest — CMAF fMP4 ready

`internal/ingest/abr.go` packs **720p / 480p / 360p** with FFmpeg:

- `-hls_segment_type fmp4`
- `init.mp4` + `seg_*.m4s` per rendition

These segments are **DASH-IF CMAF** compatible. No second transcode pass is needed for DASH.

### Playout — sliding window already built

`internal/playout/manifest.go`:

1. `collectWindowSegments()` — walks schedule, symlinks source CMAF into `{channels}/{slug}/live/{rendition}/w*.m4s`
2. `renderManifest()` — emits LL-HLS media playlist with `#EXT-X-MAP`, `#EXT-X-DISCONTINUITY`, `#EXT-X-PROGRAM-DATE-TIME`

`internal/playout/engine.go` tick loop (500 ms) rebuilds master + per-variant HLS for all `ingest.DefaultRenditions`.

### Serving — segment routes exist

`internal/stream/hls.go` serves manifests and `.m4s` / `init.mp4` with correct `Content-Type` and cache headers.

### Not implemented

- No `internal/stream/dash.go`
- No MPD builder
- No `dashUrl` in `NowPlayingResult`
- No Caddy `/dash/*` block
- Frontend `LinearPlayer.tsx` is **hls.js only**

---

## Architecture (target)

```text
                    ┌─────────────────────────────────────┐
                    │  playout tick (existing)            │
                    │  collectWindowSegments()  ◄── shared│
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
    renderManifest()                          renderMPD()
    (HLS .m3u8)                               (DASH .mpd)
              │                                         │
              ▼                                         ▼
    /hls/{slug}/index.m3u8                   /dash/{slug}/manifest.mpd
    /hls/{slug}/{rend}/index.m3u8            (single multi-rendition MPD)
    /hls/{slug}/{rend}/w*.m4s  ◄── same files ──►  referenced by MPD SegmentTemplate
```

**Key design choice:** one **multi-representation MPD** at `/dash/{slug}/manifest.mpd` (not per-rendition MPDs). Segment bytes stay under existing `/hls/{slug}/{rendition}/` paths to avoid duplicating storage or symlink logic.

---

## Implementation steps

### Step 1 — Refactor segment collection (prerequisite)

**Goal:** HLS and DASH share one segment list per rendition.

| Task | File | Notes |
|------|------|-------|
| Extract `[]manifestSegment` builder | `manifest.go` | Already returns segments before `renderManifest`; expose as `BuildWindowSegments(in ManifestInput) ([]manifestSegment, error)` |
| Keep symlink side effects in one place | `manifest.go` | `syncLiveFiles`, `linkSegment`, `ensureInit` unchanged |

**Effort:** small refactor (~30 LOC moved, no behavior change).  
**Validation:** existing HLS URLs unchanged; compare ETags before/after.

---

### Step 2 — Live MPD generator (single rendition, v1)

**Goal:** Minimal live MPD for one video AdaptationSet.

| Task | File | Notes |
|------|------|-------|
| Add `BuildLiveMPD(slug, segments, renditions, at time.Time)` | `internal/playout/mpd.go` | ISO 23009-1 XML |
| Profile | — | `urn:mpeg:dash:profile:isoff-live:2011` (not LL-DASH initially) |
| Static attrs | MPD root | `type="dynamic"`, `minimumUpdatePeriod="PT2S"`, `timeShiftBufferDepth="PT24S"` (window × 2 s), `availabilityStartTime` anchored to first segment PDT |
| Segment addressing | SegmentTemplate | `media="/hls/{slug}/{rend}/w$Number%05d$.m4s"`, `initialization="/hls/{slug}/{rend}/init.mp4"`, `startNumber="1"`, `timescale="1"`, `duration="2000"` (2 s segments) |
| Or SegmentTimeline | — | Prefer **SegmentTimeline** when discontinuities exist (Step 4) |

**Effort:** ~150 LOC.  
**Validation:** [DASH-IF Conformance Tool](https://conformance.dashif.org/) or `mp4dash --validate` on saved MPD; play in VLC or `dash.js` debug player.

---

### Step 3 — Multi-rendition ABR MPD

**Goal:** One MPD with three Representations (720p / 480p / 360p).

| Task | Notes |
|------|-------|
| One `AdaptationSet` (video) | Three `Representation` elements with `bandwidth`, `width`, `height`, `codecs="avc1.4d401f"` |
| One `AdaptationSet` (audio) | Optional if muxed in fMP4 — typically **video AdaptationSet includes audio** for CMAF (`codecs="avc1...,mp4a.40.2"`) |
| `@selectionPriority` / `@maxWidth` | Optional; dash.js auto-switches by bandwidth |

Reuse bandwidth numbers from `ingest.DefaultRenditions`.

**Effort:** ~80 LOC on top of Step 2.  
**Validation:** dash.js ABR switching on `/dash/{slug}/manifest.mpd`.

---

### Step 4 — Discontinuities (schedule boundaries & gaps)

**Goal:** Correct playback across item changes and slate loops.

HLS today:

```199:225:ewatv-playout-backend/internal/playout/manifest.go
func renderManifest(segments []manifestSegment) []byte {
	// ...
		if seg.Discontinuity {
			b.WriteString("#EXT-X-DISCONTINUITY\n")
			mapWritten = false
		}
```

DASH options (pick one):

| Approach | Pros | Cons |
|----------|------|------|
| **A. New Period per discontinuity** | Clean spec model | MPD grows; players re-init decoder; complex dynamic updates |
| **B. SegmentTimeline with `@t` gaps** | Single Period | Must recalc timeline each tick; easy to get wrong |
| **C. `@presentationTimeOffset` reset per Period** | Works with shared init | Still multi-Period |

**Recommendation:** **Period per schedule item** when `Discontinuity == true` on first segment of item. Each Period gets its own `SegmentTimeline` or `SegmentTemplate` with local `startNumber`.

**Effort:** largest slice of DASH work (~100–150 LOC + testing).  
**Risk:** medium — gap slate ↔ program transitions are the edge cases.

---

### Step 5 — Engine + cache integration

**Goal:** MPD built on same tick as HLS.

| Task | File |
|------|------|
| Add `masterMPD []byte`, `mpdETag string` to `channelRuntime` | `engine.go` |
| Call `BuildLiveMPD(...)` in tick when `startIdx >= 0` | `engine.go` |
| `GetMPD(slug) (ManifestView, bool)` | `engine.go` |

Mirror HLS ETag / 304 behavior.

**Effort:** ~40 LOC.

---

### Step 6 — HTTP routes + Caddy

| Task | Location |
|------|----------|
| `GET /dash/:slug/manifest.mpd` | `internal/stream/dash.go` (new) |
| Register in app | `internal/server/app.go` |
| Reverse proxy | `deployments/podman/Caddyfile` — add `handle /dash/*` |
| OpenAPI | `api/openapi.yaml` |
| Config helper | `PlayoutConfig.DASHURL(slug)` in `config.go` |

Content-Type: `application/dash+xml`

**Effort:** ~60 LOC.

---

### Step 7 — `nowPlaying` contract (optional)

Extend JSON (backward compatible):

```json
{
  "hlsUrl": "https://playout.example.com/hls/news/index.m3u8",
  "dashUrl": "https://playout.example.com/dash/news/manifest.mpd"
}
```

Frontend can ignore until player supports DASH.

**Effort:** ~20 LOC backend; update `src/lib/playout-backend` types if used.

---

### Step 8 — Frontend player (optional)

Only if product requires in-browser DASH:

| Task | File | Notes |
|------|------|-------|
| Add `dashjs` dependency | `package.json` | ~200 KB gzip |
| Extend `LinearPlayer` or add `LinearDashPlayer` | `LinearPlayer.tsx` | Prop: `streamUrl` + `format: 'hls' \| 'dash'` |
| Env | `.env.example` | `VITE_PREFER_DASH=false` |

**Recommendation:** default **HLS**; enable DASH via query param or channel setting for testing.

Safari/iOS: native HLS is preferred — do not replace hls.js path on Apple platforms.

**Effort:** ~100 LOC.

---

### Step 9 — Testing checklist

| Test | Tool |
|------|------|
| MPD well-formed XML | `xmllint`, DASH-IF validator |
| Single-rendition playback | VLC, ffplay |
| ABR switching | dash.js reference player |
| Discontinuity at item boundary | Manual: schedule two videos back-to-back |
| Gap slate loop | Gap item in schedule |
| Cache headers | MPD `no-cache`; segments `immutable` |
| Caddy TLS path | Tailscale / public domain |

No automated test script in repo today — manual + validator tools.

---

## What you do **not** need to redo

| Item | Reason |
|------|--------|
| FFmpeg ingest pipeline | CMAF fMP4 already DASH-compatible |
| ABR ladder encoding | Same renditions feed both protocols |
| Segment symlink window | Shared live dirs |
| Playout scheduler / day rollover | Protocol-agnostic |
| Logo overlays | Remain frontend-side (`PlayoutOverlay.tsx`) |
| Nightly Mist-style cron | Go engine auto-reloads schedule |

---

## Effort & priority matrix

| Step | Complexity | Value for EWATV | Depends on |
|------|------------|-----------------|------------|
| 1 Refactor segments | Low | Enables DASH | — |
| 2 Single-rendition MPD | Medium | Demo / VLC | 1 |
| 3 Multi-rendition MPD | Medium | Corporate ABR spec | 2 |
| 4 Discontinuities | **High** | Production correctness | 2 |
| 5 Engine integration | Low | Required | 2 |
| 6 Routes + Caddy | Low | Required | 5 |
| 7 nowPlaying | Low | Nice | 5 |
| 8 Frontend dash.js | Low–Med | Only if browser DASH required | 6 |
| 9 Testing | Medium | Required before prod | All |

**Minimum viable DASH (lab):** Steps 1 → 2 → 5 → 6 (single rendition, happy-path timeline).  
**Production parity with HLS:** add Steps 3 + 4 + 9.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| DASH players handle Period resets differently | Test dash.js + one ExoPlayer target; document supported clients |
| MPD XML bugs break all renditions | Golden-file tests for MPD output; validator in CI later |
| Dual manifest maintenance | Shared `manifestSegment` slice; single tick builds both |
| Low-Latency DASH (LL-DASH) expectations | Document **standard live DASH** first; LL-DASH is a separate profile |
| CDN caching MPD too long | Same as HLS: `Cache-Control: no-cache` on MPD only |

---

## Comparison: HLS vs DASH for this project

| | HLS (today) | DASH (proposed) |
|--|-------------|-----------------|
| **Segments** | CMAF fMP4 | Same files |
| **Web player** | hls.js ✅ | dash.js (extra dep) |
| **iOS / Safari** | Native ✅ | Poor / unnecessary |
| **Android TV** | hls.js / ExoPlayer HLS | ExoPlayer DASH (some OEMs) |
| **Manifest complexity** | Lower | Higher (XML, Periods) |
| **Operational** | Already in Caddy | +one location block |

---

## Suggested trigger to implement

Implement DASH when **any** of:

1. Partner FAST / OTT platform requires `.mpd` ingest URL  
2. Android TV app mandates DASH (no HLS)  
3. Broadcaster RFP lists MPEG-DASH as mandatory delivery format  

Until then, **HLS + ABR** satisfies mobile-first and 200 concurrent viewers on AX42.

---

## Related files

| Path | Role |
|------|------|
| `internal/playout/manifest.go` | Segment window + HLS render (extend) |
| `internal/playout/engine.go` | Tick loop (add MPD build) |
| `internal/stream/hls.go` | Pattern for `dash.go` |
| `internal/ingest/abr.go` | Rendition metadata for MPD |
| `internal/config/config.go` | Add `DASHURL()` |
| `deployments/podman/Caddyfile` | Add `/dash/*` |
| `src/components/playout/LinearPlayer.tsx` | Optional dash.js |
