# ewatv Mist playout stack

Docker Compose stack for **MistServer** (24/7 HLS), **playlist-sync** (writes `.pls` + `addstream`), and **Caddy** (reverse proxy).

## Ports (Mist defaults)

| Service | Port | Purpose |
|---------|------|---------|
| Mist API | **4242** | JSON `command=` API (`/api2`) |
| Mist HTTP | **8080** | HLS `/hls/{stream}/index.m3u8`, CMAF `/cmaf/...` |
| playlist-sync | **8787** | Internal; exposed via Caddy `/playlist-sync/` |
| Caddy | **80** / **443** | Public edge |

> `.lovable/plan.md` mentions 24241/18784 — treat those as optional custom mappings. This stack uses Mist defaults.

## Quick start

```bash
cd deploy/mist
cp .env.example .env
# Create gap clip (1.5s black) for schedule transitions:
ffmpeg -f lavfi -i color=c=black:s=1280x720:r=25 -t 1.5 \
  -c:v libx264 -pix_fmt yuv420p -an media/gap-black.mp4

docker compose up -d --build
```

1. Open http://localhost:4242 and set Mist admin password (first run).
2. Match `MIST_API_USER` / `MIST_API_PASSWORD` in `.env` and in Lovable secrets.
3. Point Lovable env:
   - `MIST_PLAYLIST_SYNC_URL=https://tv.example.com/playlist-sync`
   - `MIST_PLAYLIST_SYNC_TOKEN` = same as `PLAYLIST_SYNC_TOKEN`
   - `VITE_MIST_HLS_BASE=https://tv.example.com/hls`

## Playlist format

Mist **Playlist** input reads a `.pls` file (local paths only — not remote HTTPS in `.pls`).

- Video lines: `/media/your-file.mp4` (mounted read-only)
- Gap / black: `/media/gap-black.mp4` (logo stays on in the **ewatv player**, not burned into video)
- ewatv `pushScheduleToMist` writes the file via playlist-sync, then calls `addstream`.

## Security

- Do **not** expose port 4242 publicly; use Caddy + firewall / Tailscale.
- Protect playlist-sync with `PLAYLIST_SYNC_TOKEN` (Bearer or `X-Playlist-Sync-Token`).

## OS notes

Works on Ubuntu, Fedora Server, or CoreOS with Podman by translating `docker compose` → `podman compose` and the same compose file.
