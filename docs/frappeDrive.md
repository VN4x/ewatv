# Frappe Drive as storage + playout for ewatv

## TL;DR
Frappe Drive is a **file manager + simple file streamer**, not a playout / linear-TV engine. Self-hosting it on a fast server gives you nice upload UX and a working single-file `<video>` preview, but it does **not** replace MistServer for back-to-back linear playout, and it does **not** give you better delivery than just serving MP4s from Caddy/nginx yourself. For ewatv it is a sideways move at best.

## What VideoPreview.vue actually does
Source: `frontend/src/components/FileTypePreview/VideoPreview.vue`.

- Renders a plain HTML5 `<video controls autoplay muted preload="none">`.
- `src` points to a single Frappe endpoint:
  `/api/method/drive.api.files.stream_file_content?entity_name=...`
- The comment in the file says it bluntly: *"Server side byte is good enough for now"* — i.e. it's a **byte-range MP4 stream**, not HLS, not DASH, no ABR, no segmenting, no DRM, no concat.
- Codec assumption: H.264/H.265 in MP4/WebM. Anything else is the user's problem.
- Single-asset only: there is no playlist, no "next file", no schedule, no gap insertion, no overlay.

So the "playout quality" of Frappe Drive's player is exactly what an `<video src="file.mp4">` tag gives you on any static host. A fast server helps seek latency and concurrent viewers, but it doesn't add features Mist provides.

## Strengths if self-hosted on a powerful VPS
- Nice web UI for uploads, folders, sharing, permissions, comments — better than raw S3/Mega for human editors.
- Built-in auth, ACLs, share links, team workspaces.
- HTTP byte-range streaming is fine for **VOD preview** and direct downloads.
- Bandwidth path becomes VPS → viewer, fully under your control (no Mega quotas, no Strimm middleman).
- Open source, self-hostable, no per-GB egress fees beyond your VPS bill.

## Hard limitations for ewatv's use case
1. **No linear/24-7 channel.** No `.pls`, no concat demuxer, no scheduled stitching. You'd still need Mist (or a custom stitcher) on top.
2. **No HLS/DASH output.** Mobile Safari is fine with MP4 byte-range, but you lose adaptive bitrate, low-latency tuning, and the ability to swap segments mid-stream (needed for second-precision schedule edits).
3. **No overlay / logo / now-next burn-in.** Mist + your hls.js player already solve this; Drive doesn't touch it.
4. **Frappe runtime overhead.** Every video request goes through Python/Frappe's request stack instead of a static-file server. On a powerful box this is acceptable but it is strictly slower per-byte than Caddy/nginx serving the same MP4 — so "speed" is not actually a win vs. a plain static origin.
5. **Concurrency model.** Frappe is gunicorn workers + Redis; tuning it to push many concurrent video streams is more work than just pointing nginx at a folder.
6. **Asset pipeline missing.** No transcoding to a single normalized profile, no thumbnail/sprite generation tuned for TV, no ad-marker support.
7. **Storage coupling.** Files live inside the Frappe bench (`sites/.../private/files`). Moving them later (to S3, R2, Mist's `/media`) means writing migration scripts; the Drive DB tracks them by `entity_name`.

## How it compares to options already on the table
| Option | Storage | Stitching | Egress | Linear playout | Effort |
|---|---|---|---|---|---|
| Mist + Mega (today) | Mega Pro | Mist `.pls` | VPS | yes | shipped |
| Mist + MEGAcmd cache | Mega + VPS disk | Mist `.pls` | VPS | yes | low |
| Client-direct from Mega | Mega Pro | App + hls.js | Mega | yes (client-stitched) | medium |
| **Frappe Drive + Mist** | Drive on VPS | Mist `.pls` (pointing at Drive paths or HTTP) | VPS | yes, via Mist | medium |
| **Frappe Drive alone** | Drive on VPS | none | VPS | **no** | low setup, big gap |
| Static MP4 on VPS (Caddy) + Mist | VPS disk | Mist `.pls` | VPS | yes | already in repo |

The Drive-alone row is the apples-to-apples answer to "can we replace Mist with Frappe Drive?" — no.

## Where Drive could genuinely help ewatv
- **As the media library UI** for non-technical editors: upload, tag, preview, comment, then a server fn copies/symlinks the asset into `/media/videos/{uuid}.mp4` for Mist. This is essentially using Drive as a CMS in front of the existing playout pipeline.
- **As a private review/screener tool** for unaired episodes — its single-file player is fine for that.

## Recommendation
- **Do not** adopt Frappe Drive as the playout origin. Its VideoPreview is a single-file HTML5 player; "playout quality" is identical to any static MP4 host, and you lose Mist's stitching/HLS/overlay path.
- **Consider** Drive only as an upload/library UI layered on top of the existing Mist + `/media` flow, and only if the team actually wants a Google-Drive-style interface. Otherwise the current Collections page + a plain object store is simpler.
- Keep evaluating the real cost lever (Strimm €100/mo + Mega egress): that's solved by **Option A (client-direct Mega)** or **MEGAcmd cache + static origin**, not by Frappe Drive.
