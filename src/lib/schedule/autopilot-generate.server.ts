import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { recomputeStartTimes } from "@/lib/schedule/timeline.server";
import {
  getAutopilotTimezone,
  hourInTz,
  slotForLocalHour,
  startOfCalendarDayMs,
  type SlotDaypart,
} from "@/lib/schedule/timezone.server";

type VideoRow = {
  id: string;
  title: string;
  length_sec: number;
  category: string | null;
  daypart: "any" | "primetime" | "night";
  source_type: string;
  source_ref: string;
};

export type GeneratedScheduleItem = {
  video_id: string;
  duration_ms: number;
  transition_ms: number;
  start_at: string;
  source_snapshot: Record<string, unknown>;
};

const MS_24H = 86_400_000;
const DEFAULT_TRANSITION_MS = 2000;
const CATEGORY_MEMORY = 3;

function videoMatchesSlot(video: VideoRow, slot: SlotDaypart): boolean {
  if (video.daypart === "any") return true;
  return video.daypart === slot;
}

function pickVideo(
  pool: VideoRow[],
  slot: SlotDaypart,
  recentCategories: string[],
): VideoRow | null {
  const candidates = pool.filter(
    (v) =>
      videoMatchesSlot(v, slot) &&
      (!v.category || !recentCategories.includes(v.category)),
  );
  const fallback = pool.filter((v) => videoMatchesSlot(v, slot));
  const bag = candidates.length > 0 ? candidates : fallback.length > 0 ? fallback : pool;
  if (bag.length === 0) return null;
  const idx = Math.floor(Math.random() * bag.length);
  return bag[idx] ?? null;
}

function rememberCategory(recent: string[], category: string | null) {
  if (!category) return;
  recent.push(category);
  while (recent.length > CATEGORY_MEMORY) recent.shift();
}

/**
 * Rule-based 24h fill: daypart-aware picks, avoid repeating category within 3 items.
 */
export async function generateAutopilotScheduleItems(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  scheduleDate: string,
): Promise<GeneratedScheduleItem[]> {
  const tz = getAutopilotTimezone();
  const { data: videos, error } = await supabase
    .from("videos")
    .select("id, title, length_sec, category, daypart, source_type, source_ref")
    .eq("owner_id", ownerId)
    .order("title");

  if (error) throw error;
  const pool = (videos ?? []) as VideoRow[];
  if (pool.length === 0) {
    throw new Error("No videos in library — add videos in Collections first");
  }

  const dayStartMs = startOfCalendarDayMs(scheduleDate, tz);
  const dayEndMs = dayStartMs + MS_24H;
  const recentCategories: string[] = [];
  const timeline: Array<{
    video_id: string;
    duration_ms: number;
    transition_ms: number;
    source_snapshot: Record<string, unknown>;
  }> = [];

  let cursorMs = dayStartMs;
  let guard = 0;

  while (cursorMs < dayEndMs && guard < 500) {
    guard++;
    const hour = hourInTz(new Date(cursorMs), tz);
    const slot = slotForLocalHour(hour);
    const video = pickVideo(pool, slot, recentCategories);
    if (!video) break;

    const duration_ms = Math.max(1, video.length_sec) * 1000;
    const remaining = dayEndMs - cursorMs;
    if (duration_ms + DEFAULT_TRANSITION_MS > remaining) break;

    timeline.push({
      video_id: video.id,
      duration_ms,
      transition_ms: DEFAULT_TRANSITION_MS,
      source_snapshot: {
        title: video.title,
        source_type: video.source_type,
        source_ref: video.source_ref,
        category: video.category,
        daypart: video.daypart,
        generated_by: "autopilot",
      },
    });

    rememberCategory(recentCategories, video.category);
    cursorMs += duration_ms + DEFAULT_TRANSITION_MS;
  }

  const withTimes = recomputeStartTimes(
    timeline.map((t, position) => ({ ...t, position })),
    new Date(dayStartMs),
  );

  return withTimes.map((it, index) => ({
    video_id: timeline[index]!.video_id,
    duration_ms: it.duration_ms,
    transition_ms: it.transition_ms,
    start_at: it.start_at,
    source_snapshot: timeline[index]!.source_snapshot,
  }));
}
