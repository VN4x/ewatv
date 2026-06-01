---
name: ewatv-mist-playout
description: Implement or debug ewatv MistServer VPS playout, pushScheduleToMist, playlist-sync, and HLS player. Use when working on deploy/mist, playout page, or Mist API integration.
---

# ewatv Mist playout skill

## When to use

- Adding playout features, fixing Mist push failures, or extending `deploy/mist`.
- Smoke-testing schedule → `.pls` → HLS.

## Workflow

1. **VPS:** `cd deploy/mist && cp .env.example .env && docker compose up -d --build`
2. Create gap asset: `ffmpeg ... -t 1.5 media/gap-black.mp4` (see `deploy/mist/README.md`)
3. **Lovable secrets:** match `MIST_API_*`, `MIST_PLAYLIST_SYNC_*`, `VITE_MIST_HLS_BASE`
4. **App:** `/playout` → Ensure channel → Create smoke schedule → Push to Mist

## Key files

| File | Role |
|------|------|
| `deploy/mist/docker-compose.yml` | Mist + playlist-sync + Caddy |
| `deploy/mist/playlist-sync/server.mjs` | Writes `.pls`, calls `addstream` |
| `src/lib/mist/playlist.server.ts` | Build `.pls`, gaps, VPS POST |
| `src/lib/mist/client.server.ts` | Mist API auth + direct source |
| `src/lib/api/mist.functions.ts` | `pushScheduleToMist`, `createSmokeSchedule` |

## Mist API auth

```text
password_hash = MD5( MD5(plain_password) + challenge )
```

Send `authorize` with empty password first to get `challenge`, then call with hash.

## Gap items

DB row: `video_id: null`, `source_snapshot: { kind: "gap", duration_ms: 1500, show_logo: true }`

`.pls` line: `/media/gap-black.mp4` (must exist on VPS).

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Push 401 | `MIST_PLAYLIST_SYNC_TOKEN` matches VPS `.env` |
| Empty HLS | Mist UI :4242, stream `always_on`, media paths exist |
| RLS on schedule | User owns `schedules` / `schedule_items` |
| Direct smoke fails | `MEGA_S3_*` or use `direct_url` video |

## Tests without VPS

Use **Direct URL smoke** toggle on `/playout` with `MIST_API_URL` pointing at reachable Mist (requires `MIST_API_PASSWORD`).
