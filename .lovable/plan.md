## What I'll build

### 1. New `/channels/$slug/settings` page

A dedicated per-channel settings page (linked from Schedules header), so the page can grow over time. Initial fields:

- **Name & slug** — moved out of the small icon dialog on Schedules into a proper form (validation + slug-collision check kept).
- **Overlay logo URL** — edits `channels.overlay_logo_url` with a live preview. Always shown by default; per-video `hide_overlay` still hides it on videos that have the logo burnt in.
- **Fallback URL** — edits `channels.fallback_youtube_url` (kept as the column name, label changed to "Fallback URL"). Accepts any URL (YouTube, MP4, png or jpg on the same VPS, etc.) — used when Mega/Mist fails.
- **Transition gap** — single channel-wide value (default 7000 ms, minimum can be 0 or max 60000 ms). Stored in `channels.settings.transition_ms`. Replaces per-item gap on Schedules.
- **Embed** — copy-paste `<iframe>` snippet pointing at the new `/embed/{slug}` route, plus width/height fully responsive and adjusting to any smartphone screen, full screen no borders, logo always in same screen position . Includes a small live preview iframe. No autoplay/muted toggle in the snippet — the embed route is always autoplay+muted (browser policy).
- **Create & Danger zone** — create channel, delete-channel and edit channel name moved here (kept the safe-delete confirm with schedule count) while schedule has dropdown to choose between those channels. Each channel may have different logo overlay

### 2. Schedules page cleanup

- Fix the current syntax breakage (duplicated `editChannel` mutation, duplicated edit/delete dialogs, and the orphaned `<Button>Create` JSX inside the toolbar).
- Remove the per-item "gap" number input from each row.
- Show channel-wide gap as a read-only badge near the totals ("Gap 7s — edit in Settings →").
- Replace per-item edit/delete/rename icon buttons with a single **Settings** link button → opens the new page.
- On save, every item's `transition_ms` is set to the channel value.

### 3. New `/embed/$channelSlug` route

Minimal, no app chrome: black background, full-bleed `<LinearPlayer>` with the `PlayoutOverlay`, autoplay + muted. Designed for embedding via iframe.

### 4. 7-sec NEXT card overlay (overlay-only — no media changes)

Update `PlayoutOverlay.tsx`:

- When `now.current.isGap` is true, render a large centered card:
  ```
  NEXT
  <next.title>
  <next.description>           (line-clamped 2)
  <HH:mm – HH:mm of next item>
  ```
- Logo is forced on during this card regardless of any flag.
- During normal video playback, logo respects `hide_overlay` (so burnt-in-logo videos can hide it).

`useNowPlaying` already returns `current.isGap` and `next.title/startsAt` — I'll extend it to also return next-item duration so the card can show the end time.

### 5. Channel settings type

Add `transition_ms: number` to `ChannelPlayoutSettings` (default 7000, range 0–60000). `mergePlayoutIntoSettings` updated. Mist playlist generator (`playlist.server.ts`) and autopilot generator already read `transition_ms` from items, no change needed there beyond ensuring the value is written from the channel.

## Out of scope (call out)

- No DB migration is required (everything fits in existing columns: `channels.settings` jsonb, `overlay_logo_url`, `fallback_youtube_url`).
- The fallback column keeps its current name `fallback_youtube_url` to avoid a migration; only the label changes. Happy to rename later if you want.
- Logo upload via storage bucket — for now only URL paste. Create oprion upload logo and wire Lovable Cloud storage
- "Transition announcements" (TTS/audio over the NEXT card) — listed for the future, not built now.

## Files touched

```text
src/lib/channels/settings.ts                 (add transition_ms)
src/routes/_authenticated/schedules.tsx      (fix breakage, drop per-item gap, link to settings)
src/routes/_authenticated/channels.$slug.settings.tsx   (new)
src/routes/embed.$channelSlug.tsx            (new)
src/components/playout/PlayoutOverlay.tsx    (NEXT card on gap)
src/hooks/useNowPlaying.ts                   (expose next duration)
src/lib/api/playout.functions.ts             (return next duration)
```

Confirm and I'll ship it.