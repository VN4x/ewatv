# AGENTS.md

## Cursor Cloud specific instructions

### Product scope

**ewatv** is a single TanStack Start (React 19 + SSR) app at the repo root — not a monorepo. Implemented today: landing, login, **Collections** CRUD. `/schedules` and `/playout` are placeholders. MistServer/Mega playout from `.lovable/plan.md` is not wired in this repo yet.

### Dependencies

- Use **npm** (`package-lock.json`). `bun.lock` exists but Bun is not required on the VM; `npm install` is sufficient.
- Required env vars are in committed `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and server-side `SUPABASE_*`). The app throws at runtime if Supabase client config is missing.

### Run (development)

See `package.json` scripts:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite + TanStack Start dev server (primary dev workflow) |
| `npm run build` | Production client + SSR build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint (includes Prettier rules) |

**Dev server URL:** In this Cloud VM, `npm run dev` binds to **port 8080** (Lovable/vite-tanstack sandbox detection), e.g. `http://localhost:8080/`. Do not assume port 5173.

Run the dev server in **tmux** for long-lived processes (see Cloud Agent shell docs).

### External services (required for E2E)

| Service | Notes |
|---------|--------|
| **Hosted Supabase** (Lovable Cloud) | Auth + Postgres + RLS. No `docker-compose` or documented local Supabase CLI workflow in-repo. |
| **Optional:** Lovable OAuth (`@lovable.dev/cloud-auth-js`) | Google sign-in on `/login`; email/password works without it. |

MistServer, Mega S3, and Caddy from the architecture plan are **out of scope** until implemented.

### Lint / tests

- **`npm run lint`** currently reports many **Prettier formatting** violations in existing source files (not a missing install issue). Fixing is separate from env setup.
- **No automated test script** in `package.json` (no Vitest/Playwright). Validate behavior via the dev server and browser.

### Manual “hello world” (core functionality)

1. `npm run dev` → open `http://localhost:8080/`
2. `/login` → sign in or sign up (email + password, min 8 chars)
3. `/collections` → create a folder/collection (appears under **FOLDERS**)

RLS on `collections` requires an authenticated session tied to a user profile (created on signup via `handle_new_user` trigger). Raw REST calls without a valid session/user context will get RLS errors.

### Supabase migrations

Schema lives under `supabase/migrations/`. There is `supabase/config.toml` but no documented “start local Supabase” flow in the repo; agents should use the hosted project from `.env` unless you explicitly add local Supabase tooling.
