# Frontend technology evaluation

## Recommendation: **keep React (TanStack Start) for admin; minimal JS for embed**

Do **not** rewrite the admin UI to Svelte or Next.js unless starting a greenfield product. The ewatv repo already has:

- Collections folder tree + video CRUD
- Schedules timeline with drag-and-drop
- Channel settings, overlays, embed snippet
- `LinearPlayer` + hls.js + `PlayoutOverlay`

**Migration path:** replace Supabase client calls with a thin REST client pointed at `ewatv-playout-backend` (`/v1/*` + local JWT). UI components stay.

## Option comparison

| Stack | Admin UI | Playout embed | Verdict |
|-------|----------|---------------|---------|
| **React + TanStack Start** (current) | Already built | LinearPlayer works | **Keep** — lowest cost to production |
| **SvelteKit** | Rewrite all screens | New player | High cost; only if team prefers Svelte |
| **Next.js** | Rewrite + SSR | Same hls.js | Good for marketing site; overkill for internal admin |
| **Native JS / Alpine** | Rebuild everything | Tiny embed possible | Too much rework for admin |
| **No frontend** | curl / API only | VLC + `/hls/` | Valid for headless; add SPA later |

## Suggested split

| Surface | Tech | Host |
|---------|------|------|
| **Admin** (operators) | Existing React app → Go API | Caddy `/` static or separate subdomain |
| **Public embed** | `<iframe>` + hls.js (existing) | `/embed/{slug}` or static HTML |
| **API** | Go Fiber | Caddy `/v1`, `/hls` |

## When to reconsider

- **Svelte**: new lightweight **viewer-only** micro-app (not admin rewrite)
- **Next.js**: public marketing / EPG website separate from playout admin
- **Native mobile**: Flutter/RN apps consuming same REST + HLS URLs

## Next implementation step

Add `packages/playout-client` or `src/lib/api/playout-backend.ts` in ewatv:

```typescript
const API = import.meta.env.VITE_PLAYOUT_API;
export async function login(email: string, password: string) { ... }
export async function listVideos(token: string) { ... }
```

Point `VITE_PLAYOUT_HLS_BASE` at Caddy/Tailscale URL.
