# ewatv — architecture discussion notes (2026-06-02)

Consolidated notes from planning sessions: Mist vs client playout, Mega vs Bunny, VPS storage, security model, multi-channel, Lovable sync, and cost sizing.

**Operational assumptions (provided later in the day):**

| Metric | Value |
|--------|--------|
| Typical file size | **2–4 GB** (some ~500 MB, some ~5 GB) |
| Video format | **720p**, ~**4000–7000 kbps** |
| Total library | **~1 TB**, growing slowly |
| Concurrent viewers | **~200/day** (peak concurrent) |

---

## 1. Current stack (on `main` as of pull)

| Layer | Role |
|-------|------|
| **Lovable app** | TanStack Start + Supabase — Collections, Schedules, Playout, embed |
| **Postgres** | Source of truth: `channels`, `schedules`, `schedule_items`, `videos` |
| **Mist (VPS)** | 24/7 playout engine → one HLS URL per channel (`/hls/{stream}/index.m3u8`) |
| **playlist-sync** | Writes `{stream}.pls`, calls Mist `addstream` |
| **Viewer** | Custom **hls.js** + DB overlays (`nowPlaying`) — **not** Mist’s built-in player |

**Important:** Normal linear push still expects **local VPS paths** (`/media/videos/{uuid}.mp4`) in `.pls`. There is **no** automated download / delete / archive pipeline in the repo yet.

**Lovable updates merged (recent):**

- Channel settings: `/channels/$slug/settings` — gap (`transition_ms`), autopilot **update hour**, multi-overlay editor, fallback URL, embed snippet
- Public **`/embed/$channelSlug`** — autoplay + muted, `LinearPlayer` + overlays
- `nowPlaying` via **`supabaseAdmin`** (embed works without login)
- Hourly VPS cron; per-channel push hour in settings
- Skills: autopilot, Lovable playout UI, 04:00 / hourly cron docs

---

## 2. Multi-channel: how separation works

```text
channels.id + slug + mist_stream_name
    → schedules UNIQUE (channel_id, schedule_date)
    → schedule_items
    → push → /playlists/{stream}.pls → /hls/{stream}/index.m3u8
```

- **Postgres:** independent timeline per channel per calendar day.
- **Mist:** one stream name per channel — **do not** reuse the same `slug` / `mist_stream_name` for two channels.
- **UI:** channel picker on Schedules; `/playout/$channelSlug`, `/embed/$channelSlug`.
- **Concurrent playback:** yes — different pages/tabs, different `index.m3u8` URLs (VPS CPU/bandwidth is the limit).

Collections/videos are **shared** across channels; only schedules differ.

---

## 3. Mist’s player vs our hls.js player

| | Mist built-in / stream page | ewatv `LinearPlayer` (hls.js) |
|--|----------------------------|-------------------------------|
| Role | Optional debug / ops | **Product** player |
| Same stream? | Same `index.m3u8` | Same URL |
| Conflict? | **No** — two clients of one broadcast | |
| Overlays / now-next | No | From **Postgres** + `nowPlaying` |

**Do not** embed Mist iframe and hls.js on the same page (double audio).  
**Do not** expect different lineups on one stream — one stream = one today’s playlist.

---

## 4. Daily playout vs weekly DB (autopilot)

| | Postgres | Mist (on air) |
|--|----------|----------------|
| Autopilot | Rolling **7 days** (empty days only) | — |
| Each air date | Row + `schedule_items` | **Today’s** `.pls` only |
| Future days | Stored | Go live when date becomes “today” |

**When Mist updates:**

- **04:00 or earlier** (per-channel **update hour** in Settings; hourly cron matches that hour in `Europe/Helsinki`)
- **Save** on Schedules when **Playout active** and date is **today**
- Manual **Update now** in channel settings

**Not:** pushing all 7 days to Mist at once (only the last day would remain on one stream).

---

## 5. Revised playout direction (cloud → viewer)

### 5.1 Target model

```text
S3-compatible cloud (Mega / Bunny / other)  →  viewer device
No full film library mirrored on VPS
Admin-only URL entry in Collections — viewers cannot paste or edit sources
```

### 5.2 Security (revised)

| Control | Approach |
|---------|----------|
| Random URL ingest scan queue | **Not needed** if only admins add URLs |
| Viewer URL input | **None** on embed/playout — already true |
| Writes | Tighten to `has_role(admin)` on `videos` / schedules (today: owner-scoped RLS) |
| Residual risk | **Link drift** — e.g. YouTube URL later points elsewhere |

**Mitigations for link drift:**

- Prefer **`mega_s3` / Bunny video IDs** for linear schedule; YouTube only as **channel fallback**
- Optional periodic admin job: re-check metadata / canonical ID; alert on change
- CSP / embed `sandbox` where possible on fallback iframe

### 5.3 Precache (“Strimm ~10s next clip”)

The delay is usually **late fetch + new decoder session**, not “missing Mist.”

| Approach | Who precaches next |
|----------|-------------------|
| **Mist** | Server, into one HLS timeline |
| **Client linear** | **Web Worker** + signed URLs for item N+1 while N plays |

**Precache is valuable with or without Mist.**  
Implement: `signPlaybackWindow` / extend `nowPlaying` → prefetch next HLS or next Bunny manifest before cut.

**Web Workers:** do **not** put cloud signing secrets in the worker; server signs, worker prefetches bytes.

---

## 6. With Mist vs without Mist

### 6.1 With Mist (single `index.m3u8` per channel)

```text
Schedule → push today’s playlist → Mist → HLS → hls.js
```

**Pros:** one URL for embed/STB/VLC; true shared wall-clock line; server-side concat.  
**Cons:** VPS in path (bandwidth/CPU); ops (Docker, Caddy, cron); current code wants local `/media` paths unless changed to remote HTTPS pulls.

### 6.2 Without Mist (client linear)

```text
Schedule → nowPlaying + signed play URLs → hls.js / MSE → cloud CDN
```

**Pros:** no VPS film storage; fits cloud-only; you control prefetch.  
**Cons:** no single `index.m3u8`; timeline sync is your code; gapless is harder.

### 6.3 Recommendation (hybrid product flag)

- Default: **`playout_mode: client`** (Bunny or signed Mega HLS per item + prefetch).
- Optional: **`playout_mode: hls_broadcast`** (Mist) only where one URL is required.

---

## 7. VPS storage lifecycle (if keeping Mist + local files)

**Today:** nothing auto-deletes or re-downloads.

**Sensible policy if mirroring:**

| State | Meaning |
|-------|---------|
| Cloud (Mega/Bunny) | **Canonical archive** — never delete because playout ended |
| VPS `/media` | **Cache** — not full library unless you choose |

**Weekly repeat:** pin / `keep_ready` — **do not** delete after air; **do not** re-download if etag unchanged.

**Evict:** only unpinned, idle files when disk pressure — not “played once.”

### 7.1 Disk math for **full 1 TB library on VPS**

| Item | Size |
|------|------|
| Full mirror | **~1 TB** (+ gap assets, OS) → plan **≥ 1.2–1.5 TB** disk |
| Nonprofit | Bare metal / Hetzner storage-heavy box often **cheaper per TB** than small cloud VPS |

**With 1 TB library, “everything on VPS” is expensive** unless you already own big disks.

### 7.2 Better: working-set cache on VPS

```text
pinned titles + next 7–14 days scheduled + gap-black  ≪  1 TB
```

Example: 50 pinned × 3 GB ≈ 150 GB + 30-day rolling cache — far smaller than full mirror.

---

## 8. Bunny Stream vs Mega

### 8.1 What Bunny is

Upload → **free transcode** → per-video **HLS** on Bunny CDN → play via embed or **token-signed HLS** (directory tokens for segments).

**Not:** a 24/7 linear channel combiner (that’s Mist or your app).

Docs: [bunny.net/stream](https://bunny.net/stream/), [Stream API](https://docs.bunny.net/api-reference/stream), [security](https://docs.bunny.net/stream/security).

### 8.2 Avoid VPS downloads with Bunny?

| Pattern | VPS film storage? |
|---------|-------------------|
| **Client linear** — `bunny_video_id` per schedule row, sign HLS, prefetch next | **No** |
| **Bunny iframe chain** — `ended` → next video | **No** |
| **Mist pulls Bunny MP4/HLS URL** per playlist item | **No full mirror**; bytes still **through** VPS |

**Best fit for nonprofit + no big disk:** Bunny + **client linear + prefetch**.

### 8.3 Bunny vs Mega (summary)

| | Mega S3-style | Bunny Stream |
|--|---------------|--------------|
| Storage | Cheap object | ~$0.01/GB + traffic |
| Transcode | You | **Included** (consistent HLS) |
| Linear channel | Need stitch (client or Mist) | Same |
| VPS mirror | Tempting, costly at 1 TB | **Avoid** |

### 8.4 Weekly content on Bunny

Asset stays in library until **you** delete. Same `videoId` every week — **no re-download**. Transcoded renditions = “refined” copy.

---

## 9. Cost sketch (1 TB library, ~200 concurrent viewers)

*Order-of-magnitude for planning — verify on provider calculators.*

### 9.1 Full VPS mirror (1 TB)

- **Disk:** 1.2–2 TB NVMe/HDD server ≈ **€40–80+/mo** (provider-dependent)
- **Egress:** 200 viewers × hours × bitrate — if all watch via VPS HLS, VPS egress dominates
- **Ops:** your time (nonprofit hidden cost)

### 9.2 Bunny Stream (no VPS film storage)

**Storage:** 1 TB × ~$0.01/GB ≈ **~$10/mo** storage (list price tier; check current Bunny pricing).

**Delivery (rough):**  
Concurrent 200 × 5 Mbps average ≈ **1 Gbps** aggregate if fully overlapping (upper bound; real average lower).

- 1 Gbps sustained ≈ **~450 GB/hour** → a **1-hour peak** ≈ **450 GB** CDN traffic  
- At ~$0.005/GB (volume tier) ≈ **~$2.25/hour** at peak — **daily** cost depends on **hours watched**, not just concurrency

Example: 200 viewers × **2 h/day** × **5 Mbps** ≈ **~900 GB/day** delivered → **~$4.50/day** ≈ **~$135/mo** CDN (very sensitive to bitrate, overlap, and actual watch time).

**Encoding:** advertised free on Bunny — good for mixed uploads (500 MB–5 GB, 720p 4–7 Mbps).

### 9.3 Mega + client linear (no VPS mirror)

- **Storage:** ~1 TB on Mega (your existing plan)
- **Egress:** viewers pull from Mega via **short-lived signed URLs** — cost depends on Mega/plan limits
- **VPS:** small box for app + cron only — **€5–15/mo** class

### 9.4 Mist + cache (not full 1 TB)

- VPS: **200–500 GB** cache + Mist — **€20–40/mo** + egress
- Pin ~100–200 popular titles locally; rest cloud-pull on demand (if Mist configured for HTTPS sources)

**Takeaway at 1 TB + 200 concurrent:**  
Full VPS mirror is **the most expensive disk story**. **Bunny or Mega + client playout** avoids 1 TB server rent; **pay for delivery**. Bunny adds predictable HLS + transcode; Mega is cheaper storage if egress is acceptable.

---

## 10. Codec / container (without VPS ffmpeg farm)

Admin rule: **H.264 + AAC in MP4** in catalog (or use Bunny transcode).

Optional on save (admin-only): quick `ffprobe` warning in UI — **not** a public scan queue.

Mixing `.mkv` / HEVC in one Mist `.pls` or client playlist still causes freezes — normalize in **cloud** (Bunny) or at upload.

---

## 11. What we explicitly dropped or deferred

| Item | Status |
|------|--------|
| Async URL threat scan (BullMQ/Celery) | **Dropped** — admin-only ingest |
| VPS ffmpeg remux mirror queue | **Dropped** if no local mirror |
| Full library on VPS | **Discouraged** at 1 TB |
| 7-day `.pls` on Mist | **Rejected** — stay **daily** per channel |
| m3u importers, public TV without auth | **Deferred** |

---

## 12. Implementation priorities (suggested)

1. **Playback:** `bunny_stream` (or signed Mega) + `signPlaybackWindow` + Worker prefetch for next item.  
2. **DB:** `videos.bunny_video_id` / play URLs; gate schedule if asset not `ready`.  
3. **Security:** admin-only writes; keep embed read-only via `nowPlaying`.  
4. **Channel flag:** `playout_mode: client | hls_broadcast`.  
5. **Mist path (optional):** HTTPS sources in `.pls`, no `/media` mirror; or small **pinned cache** only.  
6. **Ops:** hourly cron + per-channel update hour (already on main).

---

## 13. Lovable / agent artifacts

| Artifact | Path |
|----------|------|
| Mist playout skill | `.cursor/skills/ewatv-mist-playout/SKILL.md` |
| Autopilot cron skill | `.cursor/skills/ewatv-autopilot-cron/SKILL.md` |
| Schedule timeline skill | `.cursor/skills/ewatv-schedule-timeline/SKILL.md` |
| Lovable playout prompt | `.cursor/skills/ewatv-lovable-playout-ui/SKILL.md` |
| Cron script | `deploy/cron/autopilot.sh`, `deploy/cron/README.md` |
| Mist stack | `deploy/mist/` |

**PRs (history):** #1 Mist/autopilot branch; #2 Lovable + autopilot merge; #3 Lovable settings/embed/overlays.

---

## 14. One-page decision summary

| Question | Answer |
|----------|--------|
| Separate channel per page, concurrent? | **Yes** — different stream names / play URLs |
| Mist vs our player conflict? | **No** — don’t use both on same page |
| Need URL scan queue? | **No** — admin-only; harden writes |
| Need 1 TB VPS disk? | **No** — use cloud origin + cache or client linear |
| Bunny instead of Mega? | **Strong yes** for delivery + transcode; still need app schedule stitch |
| Avoid VPS download? | **Yes** — Bunny/Mega HLS to client + prefetch; Mist optional |
| 200 viewers, 2–4 GB files? | Size library on **Bunny/storage $**; budget **CDN egress**; avoid **1 TB VPS** |

---

*Generated from architecture planning discussions. Update as decisions are implemented.*
