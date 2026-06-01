import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mergePlayoutIntoSettings,
  parseChannelPlayoutSettings,
  isAirDateToday,
} from "@/lib/channels/settings";
import type { Database } from "@/integrations/supabase/types";
import { mistAddDirectSource, publicHlsUrl } from "@/lib/mist/client.server";
import { getMistConfig } from "@/lib/mist/config.server";
import {
  buildPlsContent,
  pushPlsToVps,
  scheduleItemsToPlsLines,
} from "@/lib/mist/playlist.server";
import { parseMegaSourceRef, signMegaObjectKey } from "@/lib/mist/sign-mega.server";
import { getTodayInAutopilotTz } from "@/lib/schedule/timezone.server";

export type PushScheduleOptions = {
  insertGaps?: boolean;
  gapMs?: number;
  allowDirectUrlSmoke?: boolean;
};

export type PushScheduleResult = {
  mode: "playlist" | "direct";
  streamName: string;
  hlsUrl: string | null;
  itemCount: number;
  plsPreview?: string;
  syncResult?: unknown;
  mistResponse?: unknown;
};

type AuthSupabase = SupabaseClient<Database>;

export async function recordMistPushStatus(
  supabase: AuthSupabase,
  channelId: string,
  ownerId: string,
  patch: {
    success: boolean;
    scheduleId: string;
    errorMessage?: string;
  },
) {
  const { data: channel, error } = await supabase
    .from("channels")
    .select("settings")
    .eq("id", channelId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !channel) return;

  const merged = mergePlayoutIntoSettings(channel.settings, {
    last_mist_push_at: patch.success ? new Date().toISOString() : parseChannelPlayoutSettings(channel.settings).last_mist_push_at,
    last_mist_push_error: patch.success ? null : (patch.errorMessage ?? "Push failed"),
    last_mist_push_schedule_id: patch.scheduleId,
  });

  await supabase.from("channels").update({ settings: merged }).eq("id", channelId);
}

export async function executePushScheduleToMist(
  supabase: AuthSupabase,
  userId: string,
  scheduleId: string,
  options: PushScheduleOptions = {},
): Promise<PushScheduleResult> {
  const { data: schedule, error: schedErr } = await supabase
    .from("schedules")
    .select("id, channel_id, schedule_date, owner_id")
    .eq("id", scheduleId)
    .single();

  if (schedErr || !schedule) throw new Error("Schedule not found");
  if (schedule.owner_id !== userId) throw new Error("Forbidden");

  const { data: channel, error: chErr } = await supabase
    .from("channels")
    .select("id, name, slug, mist_stream_name, owner_id, settings")
    .eq("id", schedule.channel_id)
    .single();

  if (chErr || !channel) throw new Error("Channel not found");

  const streamName = (channel.mist_stream_name ?? channel.slug ?? "tv1").toLowerCase();

  const { data: items, error: itemsErr } = await supabase
    .from("schedule_items")
    .select(
      `
        position,
        duration_ms,
        transition_ms,
        source_snapshot,
        video:videos ( id, title, source_type, source_ref )
      `,
    )
    .eq("schedule_id", scheduleId)
    .order("position");

  if (itemsErr) throw itemsErr;
  if (!items?.length) throw new Error("Schedule has no items");

  const rows = items.map((row) => ({
    position: row.position,
    duration_ms: row.duration_ms,
    transition_ms: row.transition_ms,
    source_snapshot: (row.source_snapshot ?? {}) as Record<string, unknown>,
    video: row.video as {
      id: string;
      title: string;
      source_type: string;
      source_ref: string;
    } | null,
  }));

  const allowDirect = options.allowDirectUrlSmoke ?? false;
  if (allowDirect && rows.length === 1 && rows[0].video) {
    const v = rows[0].video;
    let sourceUrl: string | null = null;
    if (v.source_type === "direct_url") {
      sourceUrl = v.source_ref;
    } else if (v.source_type === "mega_s3") {
      const { key } = parseMegaSourceRef(v.source_ref);
      const signed = await signMegaObjectKey(key);
      sourceUrl = signed.url;
    }
    if (sourceUrl) {
      const mistResponse = await mistAddDirectSource(streamName, sourceUrl);
      return {
        mode: "direct",
        streamName,
        hlsUrl: publicHlsUrl(streamName),
        itemCount: 1,
        mistResponse,
      };
    }
  }

  const plsLines = scheduleItemsToPlsLines(rows, {
    insertGaps: options.insertGaps ?? true,
    gapMs: options.gapMs ?? getMistConfig().defaultGapMs,
  });
  const pls = buildPlsContent(plsLines);
  const syncResult = await pushPlsToVps(streamName, pls);

  return {
    mode: "playlist",
    streamName,
    hlsUrl: publicHlsUrl(streamName),
    plsPreview: pls.split("\n").slice(0, 30).join("\n"),
    itemCount: plsLines.length,
    syncResult: syncResult.body,
  };
}

export type AutoPushDecision = {
  shouldPush: boolean;
  reason?: string;
};

export function decideAutoPush(
  playoutActive: boolean,
  scheduleDate: string,
  itemCount: number,
): AutoPushDecision {
  if (!playoutActive) {
    return { shouldPush: false, reason: "Playout is off for this channel" };
  }
  if (itemCount === 0) {
    return { shouldPush: false, reason: "Schedule has no items" };
  }
  if (!isAirDateToday(scheduleDate)) {
    return {
      shouldPush: false,
      reason: "Saved for a future/past day — Mist updates only for today’s air date",
    };
  }
  return { shouldPush: true };
}

export async function autoPushIfNeeded(
  supabase: AuthSupabase,
  userId: string,
  channelId: string,
  scheduleId: string,
  scheduleDate: string,
  options: PushScheduleOptions = {},
): Promise<{ pushed: boolean; reason?: string; result?: PushScheduleResult }> {
  const { data: channel } = await supabase
    .from("channels")
    .select("settings")
    .eq("id", channelId)
    .single();

  const playout = parseChannelPlayoutSettings(channel?.settings);
  // Re-check item count from DB
  const { count } = await supabase
    .from("schedule_items")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", scheduleId);

  const finalDecision = decideAutoPush(playout.playout_active, scheduleDate, count ?? 0);
  if (!finalDecision.shouldPush) {
    return { pushed: false, reason: finalDecision.reason };
  }

  try {
    const result = await executePushScheduleToMist(supabase, userId, scheduleId, options);
    await recordMistPushStatus(supabase, channelId, userId, {
      success: true,
      scheduleId,
    });
    return { pushed: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mist push failed";
    await recordMistPushStatus(supabase, channelId, userId, {
      success: false,
      scheduleId,
      errorMessage: message,
    });
    throw err;
  }
}

/** Push today's schedule to Mist for a channel (air date). Used after weekly autopilot fill. */
export async function pushTodayAirScheduleForChannel(
  supabase: AuthSupabase,
  channelId: string,
  ownerId: string,
): Promise<{ pushed: boolean; reason?: string; scheduleId?: string }> {
  const today = getTodayInAutopilotTz();
  const { data: sched } = await supabase
    .from("schedules")
    .select("id")
    .eq("channel_id", channelId)
    .eq("schedule_date", today)
    .maybeSingle();

  if (!sched?.id) {
    return { pushed: false, reason: "No schedule for today" };
  }

  const push = await autoPushIfNeeded(supabase, ownerId, channelId, sched.id, today, {
    insertGaps: true,
  });
  return { pushed: push.pushed, reason: push.reason, scheduleId: sched.id };
}
