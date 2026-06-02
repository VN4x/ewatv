import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getMistConfig } from "@/lib/mist/config.server";

/** Today's calendar date in Europe/Helsinki as YYYY-MM-DD */
function getTodayInHelsinki(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function sanitizeStreamName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

export type NowPlayingResult = {
  streamName: string;
  hlsUrl: string | null;
  fallbackYoutubeUrl: string | null;
  channelName: string;
  channelSlug: string;
  overlayLogoUrl: string | null;
  current: {
    title: string;
    description: string | null;
    startedAt: string;
    durationMs: number;
    hideOverlay: boolean;
    videoId: string | null;
    isGap: boolean;
  } | null;
  next: {
    title: string;
    description: string | null;
    startsAt: string;
    durationMs: number;
  } | null;
};

const inputSchema = z.object({
  channelSlug: z.string().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  channelId: z.string().uuid().optional(),
  at: z.string().datetime().optional(),
}).refine((v) => v.channelSlug || v.channelId, {
  message: "channelSlug or channelId required",
});

export const nowPlaying = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<NowPlayingResult> => {
    const at = data.at ? new Date(data.at) : new Date();

    const channelQuery = supabaseAdmin
      .from("channels")
      .select("id, name, slug, mist_stream_name, overlay_logo_url, fallback_youtube_url")
      .limit(1);

    const { data: channel, error: chErr } = data.channelId
      ? await channelQuery.eq("id", data.channelId).maybeSingle()
      : await channelQuery.eq("slug", data.channelSlug!).maybeSingle();

    if (chErr) throw new Error(chErr.message);
    if (!channel) throw new Error("Channel not found");

    const streamName = sanitizeStreamName(channel.mist_stream_name ?? channel.slug ?? "tv1");
    const hlsBase = getMistConfig().publicHlsBase;
    const hlsUrl = hlsBase ? `${hlsBase.replace(/\/$/, "")}/${streamName}/index.m3u8` : null;

    const today = getTodayInHelsinki(at);
    const { data: schedule } = await supabaseAdmin
      .from("schedules")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("schedule_date", today)
      .maybeSingle();

    const base = {
      streamName,
      hlsUrl,
      fallbackYoutubeUrl: channel.fallback_youtube_url,
      channelName: channel.name,
      channelSlug: channel.slug,
      overlayLogoUrl: channel.overlay_logo_url,
    };

    if (!schedule) return { ...base, current: null, next: null };

    const { data: items } = await supabaseAdmin
      .from("schedule_items")
      .select(`position, start_at, duration_ms, transition_ms, video_id, source_snapshot,
        video:videos ( id, title, description, hide_overlay )`)
      .eq("schedule_id", schedule.id)
      .order("position");

    if (!items?.length) return { ...base, current: null, next: null };

    const atMs = at.getTime();
    let currentIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const start = new Date(it.start_at).getTime();
      const end = start + it.duration_ms + (it.transition_ms ?? 0);
      if (atMs >= start && atMs < end) {
        currentIdx = i;
        break;
      }
    }

    const itemToCurrent = (it: typeof items[number]) => {
      const snap = (it.source_snapshot ?? {}) as Record<string, unknown>;
      const isGap = snap.kind === "gap";
      const video = it.video as { id: string; title: string; description: string | null; hide_overlay: boolean } | null;
      // While inside the transition_ms portion of the previous item, treat as a gap too
      const start = new Date(it.start_at).getTime();
      const inTransition = atMs >= start + it.duration_ms;
      const treatAsGap = isGap || inTransition;
      return {
        title: treatAsGap ? "Intermission" : (video?.title ?? (snap.title as string) ?? "Untitled"),
        description: treatAsGap ? null : (video?.description ?? null),
        startedAt: it.start_at,
        durationMs: it.duration_ms,
        hideOverlay: treatAsGap ? false : (video?.hide_overlay ?? false),
        videoId: video?.id ?? null,
        isGap: treatAsGap,
      };
    };

    const current = currentIdx >= 0 ? itemToCurrent(items[currentIdx]) : null;
    const nextItem = currentIdx >= 0 ? items[currentIdx + 1] : items.find((i) => new Date(i.start_at).getTime() > atMs);
    const next = nextItem
      ? {
          title: ((nextItem.source_snapshot as Record<string, unknown>)?.kind === "gap"
            ? "Intermission"
            : ((nextItem.video as { title?: string } | null)?.title ?? "Untitled")),
          description: ((nextItem.video as { description?: string | null } | null)?.description ?? null),
          startsAt: nextItem.start_at,
          durationMs: nextItem.duration_ms,
        }
      : null;

    return { ...base, current, next };
  });
