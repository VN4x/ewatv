# Tailscale + Caddy on AX42

Access model: **Tailscale for management**, Caddy for TLS termination and routing. Viewers and admins reach the same host via MagicDNS or public DNS.

## Recommended topology

```text
Internet / Tailnet clients
        │
        ▼
  Tailscale (host daemon)
        │
        ▼
  Caddy :443 / :80  ──►  ewatv-playout :8090 (internal pod network only)
        │                      │
        │                      ├── postgres
        │                      └── redis
```

- **Playout container** is NOT published to the host — only Caddy exposes 443/80.
- **Metrics** (`/metrics`) restricted to Tailscale CGNAT `100.64.0.0/10` in Caddyfile.
- **Admin API** (`/v1/*`) reachable via same hostname; optionally split to `admin.*` with Tailscale-only ACL.

## 1. Install Tailscale on AX42 (host)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --advertise-tags=tag:ewatv
```

In Tailscale admin console:

- Create ACL tag `tag:ewatv` for the playout server
- Enable **MagicDNS** for your tailnet
- Note hostname: e.g. `ax42-playout.your-tailnet.ts.net`

## 2. Configure Caddy domain

Edit `/etc/containers/systemd/ewatv-caddy.container`:

```ini
Environment=EWATV_DOMAIN=ax42-playout.your-tailnet.ts.net
```

Edit `ewatv-playout.container`:

```ini
Environment=EWATV_PLAYOUT_PUBLIC_BASE_URL=https://ax42-playout.your-tailnet.ts.net
```

Caddy obtains TLS automatically (Let's Encrypt works if the name is public DNS; for pure MagicDNS use Tailscale Serve or internal TLS).

## 3. Tailscale Serve (optional — no public ports)

If AX42 has no public IPv4 or you want zero open firewall:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:80
```

Caddy listens on localhost:80; Tailscale terminates HTTPS for tailnet clients.

## 4. Split access policies (enterprise)

| Audience | Path | Access |
|----------|------|--------|
| Viewers | `/hls/*`, `/v1/channels/*/now-playing` | Public or tailnet |
| Operators | `/v1/*` admin CRUD | Tailscale ACL `group:ops` |
| Monitoring | `/metrics` | Tailscale only (Caddyfile) |
| DB admin | Adminer profile | Tailscale only, never public |

Example Tailscale ACL snippet:

```json
{
  "acls": [
    {"action": "accept", "src": ["group:ewatv-ops"], "dst": ["tag:ewatv:443"]},
    {"action": "accept", "src": ["*"], "dst": ["tag:ewatv:443"], "proto": "tcp", "ports": ["443"]}
  ],
  "tagOwners": {"tag:ewatv": ["group:ewatv-ops"]}
}
```

## 5. Firewall (Hetzner)

```bash
# Allow SSH + Tailscale; block direct 8090
ufw allow 22/tcp
ufw allow 41641/udp   # Tailscale
ufw allow 443/tcp     # only if public HLS needed
ufw deny 8090/tcp
ufw enable
```

## 6. Verify

```bash
curl -sf https://ax42-playout.your-tailnet.ts.net/health
curl -sf https://ax42-playout.your-tailnet.ts.net/v1/channels/main/now-playing
```

From a phone on Tailscale: open HLS URL in VLC or your embed player.
