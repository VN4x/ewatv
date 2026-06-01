---
name: ewatv-lovable-playout-ui
description: Full Lovable.dev task spec for ewatv playout viewer UI. Copy the PROMPT section into Lovable when building/refactoring playout.
---

# Lovable.dev — ewatv Playout UI (full prompt)

Copy everything inside **PROMPT START** … **PROMPT END** into Lovable as one task.

---

## PROMPT START

### Task title
**ewatv Playout viewer — custom hls.js player (Milestone 6)**

### Product context
**ewatv** is a headless linear TV control room (TanStack Start + Supabase + MistServer on VPS). Collections and Schedules exist. Mist outputs **one HLS URL per channel**. We use a **custom React player**, not Mist’s built-in web player.

**Critical architecture (do not change):**
- **Postgres** = source of truth for schedules (`schedule_items`, `videos`, `channels`).
- **Mist** = 24/7 playout engine; plays **today’s** `.pls` playlist only.
- **Weekly autopilot** fills 7 days in DB; **Mist is updated daily** (04:00 cron + manual save when Playout active).
- **Logo / now-playing / next** = **client-side** over `<video>`, using DB + `nowPlaying` server fn.

### Read before coding
- `.lovable/plan.md` (playout UX section)
- `.cursor/rules/ewatv-mist.mdc`
- Existing: `src/routes/_authenticated/playout.tsx` (smoke/Mist debug — refactor)
- Do **not** modify: `deploy/mist/*`, `pushScheduleToMist`, `saveScheduleAndPush`, `runAutopilotJobs`, `autopilot-cron.server.ts`, `push-schedule.server.ts`

### What to build

#### 1) Server function `nowPlaying`
Create **`src/lib/api/playout.functions.ts`**:

```ts
// createServerFn + requireSupabaseAuth (v1: authenticated only)
Input: { channelId: string (uuid), at?: string (ISO datetime) }
Output: {
  streamName: string,
  hlsUrl: string | null,
  current: {
    title: string,
    description: string | null,
    startedAt: string,
    durationMs: number,
    hideOverlay: boolean,
    videoId: string | null,
    isGap: boolean,
  } | null,
  next: { title: string, description: string | null, startsAt: string } | null,
}
```

**Logic:**
1. Load `channels` → `mist_stream_name` or `slug` (lowercase a-z0-9.- only).
2. `hlsUrl` = `${import.meta.env.VITE_MIST_HLS_BASE}/${streamName}/index.m3u8` (server: `process.env.VITE_MIST_HLS_BASE`).
3. **Today’s** `schedules` row for `channel_id` using calendar date in **`Europe/Helsinki`** (match `getTodayInAutopilotTz` in `src/lib/schedule/timezone.server.ts`).
4. Load `schedule_items` ordered by `position`; find row where `start_at <= at < start_at + duration_ms + transition_ms`.
5. Join `videos` when `video_id` set. If `source_snapshot.kind === "gap"` → `isGap: true`, title e.g. “Intermission”.
6. **hideOverlay** = `videos.hide_overlay` (gaps → show logo: `hideOverlay: false` for overlay logic).
7. **next** = next item by timeline.

Export hook-friendly shape for React Query polling every **5s** (1s when overlay open optional).

#### 2) Reusable components
- **`src/components/playout/LinearPlayer.tsx`**
  - Props: `hlsUrl`, `channelId`, `logoUrl`, optional `className`
  - **hls.js** with `{ lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 30 }`
  - Native Safari HLS fallback if no Mls.js
  - **No** Mist iframe player

- **`src/components/playout/PlayoutOverlay.tsx`**
  - Glassmorphism panel on hover/tap: now title, description, elapsed/remaining, next
  - Controls **only:** play/pause, mute/volume, fullscreen — **no** seek bar
  - Logo top-left ~8% width, min 48px; hidden when `current.hideOverlay && !current.isGap`

#### 3) Routes

**A) `/_authenticated/playout`** — Operator view
- Channel `<Select>` from `channels`
- Large **LinearPlayer** primary
- Status line: LIVE badge if `channels.settings.playout_active`, last Mist push time/error from `parseChannelPlayoutSettings`
- Link: “Edit today’s schedule →” to `/schedules` with channel preselect if easy
- Collapsible **“Advanced — Mist debug”** section (keep existing smoke: push, smoke schedule, JSON) — **not** primary UI

**B) `/_authenticated/playout/$channelSlug`** (or `/tv/$channelSlug` if cleaner)
- Viewer-first: minimal chrome, same player
- Resolve channel by `slug`; 404 if missing

#### 4) Styling
- Match **Schedules** / **Collections**: shadcn, `max-w-7xl`, existing nav in `_authenticated.tsx`
- Responsive 16:9 `aspect-video`, black letterboxing
- `prefers-reduced-motion` respect for overlay transitions

#### 5) Env & empty states
- Missing `VITE_MIST_HLS_BASE` → clear empty state
- Hls error → toast + “Retry load”
- No schedule today → message over player; still attach HLS if URL set

### Do NOT
- Use Mist Meta-Player / stream HTML page as main UI
- Change Mist push/autopilot server contracts
- Add YouTube embed (v1)
- Strip `/hls` from URLs
- Remove `hls.js` dependency
- Make “Push to Mist” the main operator workflow (debug only)

### Do
- `npm run build` passes
- TypeScript strict
- `requireSupabaseAuth` on `nowPlaying`
- Extract `useNowPlaying(channelId)` hook

### Acceptance criteria
1. HLS plays from `VITE_MIST_HLS_BASE/{stream}/index.m3u8`
2. Overlay shows DB-driven now/next for today (Helsinki date)
3. Logo respects `hide_overlay`; visible on gaps
4. Only play/pause, volume, fullscreen
5. Mist debug tucked in Advanced section
6. Matches ewatv visual style

### Optional polish
- Keyboard: `f` fullscreen, `m` mute
- `prefers-color-scheme` safe glass panel

## PROMPT END

---

## After Lovable ships

1. Set `VITE_MIST_HLS_BASE` in Lovable secrets.
2. Ensure VPS cron: **04:00** `Europe/Helsinki` — `deploy/cron/autopilot.sh`.
3. **Playout active** on channel + today’s schedule items on VPS `/media`.
