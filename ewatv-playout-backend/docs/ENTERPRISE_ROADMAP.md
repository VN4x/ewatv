# Enterprise linear TV features — roadmap evaluation

Features large media corporations expect from playout / OTT linear stacks. Mapped to current backend and suggested phases.

## Tier 1 — Expected for broadcast-grade (high value)

| Feature | Description | Current | Phase |
|---------|-------------|---------|-------|
| **As-run logs** | Immutable record of what aired, when, duration | Partial (`playout_state`) | Export JSON/Parquet daily |
| **EPG / TV guide API** | `GET /v1/epg?channel=&from=&to=` for apps/FAST | `now-playing` only | Full grid from `schedule_items` |
| **SCTE-35 / ad markers** | Insert cue-out/in for SSAI or local splice | None | HLS `#EXT-X-CUE` in manifest |
| **Closed captions** | CEA-608/708 in HLS | None | Sidecar WebVTT per video |
| **Multi-bitrate ABR** | 360p–1080p ladder | Single CMAF rendition | FFmpeg ladder on ingest |
| **Rights windows** | `valid_from` / `valid_until` on videos | None | Block schedule if expired |
| **Approval workflow** | Draft schedule → review → publish | Direct save | Status column + roles |
| **Failover slate** | Automatic slate if source missing | Fallback URL in channel | Engine gap + slate loop |

## Tier 2 — Scale & operations

| Feature | Description | Phase |
|---------|-------------|-------|
| **Multi-tenant / brands** | Org → channels → ACL | `owner_id` today; add `organizations` |
| **Geo restrictions** | Tailscale / IP / country allowlist | Caddy + GeoIP module |
| **Disaster recovery** | Secondary AX42 hot-standby | Postgres replica + rsync `/data` |
| **MAM integration** | Asset pick from Dalet/Viz One/etc. | Webhook ingest from MAM |
| **Live break-in** | Override schedule for breaking news | `priority` flag on schedule_items |
| **Audience analytics** | Concurrent viewers, QoE | Prometheus + HLS session cookies |
| **Compliance retention** | GDPR delete, audit trail | Postgres audit log table |

## Tier 3 — Advanced OTT / FAST

| Feature | Description |
|---------|-------------|
| **SSAI / DAI** | Server-side ad insertion (Google Ad Manager, Yospace) |
| **DRM** | Widevine/FairPlay for premium (likely separate origin) |
| **Multi-audio / dubbing** | Language tracks in manifest |
| **4K / HDR** | HEVC ladder (AX42 can transcode 1–2 streams, not 200 viewers 4K) |
| ** Nielsen / audience measurement** | SDK or watermark integration |
| **Social / clip export** | Highlight clip from as-run + VOD segment |

## Recommended next 3 for EWATV (after quadlets)

1. **EPG API** — unlocks TV guide apps and corporate demos
2. **As-run logs** — required for ad sales and compliance
3. **ABR ladder (2–3 renditions)** — mobile-first corporate standard

DASH deferred per product decision.

## Architecture note

Corporate scale usually splits:

- **Playout origin** (this Go backend on AX42) — schedule truth, HLS origin
- **CDN** (Bunny/Cloudflare/Fastly) — viewer scale beyond ~200 concurrent
- **Ad tech** — SSAI at CDN edge

AX42 remains control + origin; CDN handles burst for large corp viewer counts.
