import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { parseChannelPlayoutSettings } from "@/lib/channels/settings";
import { generateAutopilotScheduleItems } from "@/lib/schedule/autopilot-generate.server";
import { persistScheduleAndPush } from "@/lib/schedule/persist-schedule.server";
import {
  getAutopilotTimezone,
  getTodayInAutopilotTz,
  getTomorrowInAutopilotTz,
} from "@/lib/schedule/timezone.server";
import { autoPushIfNeeded } from "@/lib/mist/push-schedule.server";

export type AutopilotJobResult = {
  timezone: string;
  today: string;
  tomorrow: string;
  generated: Array<{
    scheduleId: string;
    channelId: string;
    scheduleDate: string;
    itemCount: number;
    pushed: boolean;
    pushSkippedReason?: string;
    pushError?: string;
  }>;
  pushedToday: Array<{
    scheduleId: string;
    channelId: string;
    pushed: boolean;
    reason?: string;
    error?: string;
  }>;
  skipped: Array<{ scheduleId: string; reason: string }>;
};

async function countScheduleItems(
  supabase: SupabaseClient<Database>,
  scheduleId: string,
): Promise<number> {
  const { count } = await supabase
    .from("schedule_items")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", scheduleId);
  return count ?? 0;
}

/**
 * Daily autopilot job:
 * 1) Generate **tomorrow** for schedules with autopilot=true and no items yet.
 * 2) **Push today** for channels with playout_active and a non-empty today schedule.
 */
export async function runAutopilotJobs(
  supabase: SupabaseClient<Database>,
): Promise<AutopilotJobResult> {
  const tz = getAutopilotTimezone();
  const today = getTodayInAutopilotTz();
  const tomorrow = getTomorrowInAutopilotTz();

  const result: AutopilotJobResult = {
    timezone: tz,
    today,
    tomorrow,
    generated: [],
    pushedToday: [],
    skipped: [],
  };

  // --- 1) Generate tomorrow ---
  const { data: autopilotSchedules, error: apErr } = await supabase
    .from("schedules")
    .select("id, channel_id, owner_id, schedule_date, autopilot")
    .eq("schedule_date", tomorrow)
    .eq("autopilot", true);

  if (apErr) throw apErr;

  for (const sched of autopilotSchedules ?? []) {
    const itemCount = await countScheduleItems(supabase, sched.id);
    if (itemCount > 0) {
      result.skipped.push({
        scheduleId: sched.id,
        reason: `Tomorrow already has ${itemCount} items`,
      });
      continue;
    }

    try {
      const items = await generateAutopilotScheduleItems(supabase, sched.owner_id, tomorrow);
      const saved = await persistScheduleAndPush(supabase, sched.owner_id, {
        channelId: sched.channel_id,
        scheduleDate: tomorrow,
        autopilot: true,
        existingScheduleId: sched.id,
        items,
        insertGapsOnPush: true,
      });
      result.generated.push({
        scheduleId: saved.scheduleId,
        channelId: sched.channel_id,
        scheduleDate: tomorrow,
        itemCount: items.length,
        pushed: saved.pushed,
        pushSkippedReason: saved.pushSkippedReason,
        pushError: saved.pushError,
      });
    } catch (err) {
      result.skipped.push({
        scheduleId: sched.id,
        reason: err instanceof Error ? err.message : "Generate failed",
      });
    }
  }

  // Also: channels with playout_active but no tomorrow row — create autopilot schedule
  const { data: channels, error: chErr } = await supabase.from("channels").select("id, owner_id, settings");
  if (chErr) throw chErr;

  const tomorrowIds = new Set((autopilotSchedules ?? []).map((s) => s.channel_id));

  for (const ch of channels ?? []) {
    if (tomorrowIds.has(ch.id)) continue;
    const playout = parseChannelPlayoutSettings(ch.settings);
    if (!playout.playout_active) continue;

    const { data: existing } = await supabase
      .from("schedules")
      .select("id")
      .eq("channel_id", ch.id)
      .eq("schedule_date", tomorrow)
      .maybeSingle();

    if (existing) continue;

    try {
      const items = await generateAutopilotScheduleItems(supabase, ch.owner_id, tomorrow);
      const saved = await persistScheduleAndPush(supabase, ch.owner_id, {
        channelId: ch.id,
        scheduleDate: tomorrow,
        autopilot: true,
        items,
        insertGapsOnPush: true,
      });
      result.generated.push({
        scheduleId: saved.scheduleId,
        channelId: ch.id,
        scheduleDate: tomorrow,
        itemCount: items.length,
        pushed: saved.pushed,
        pushSkippedReason: saved.pushSkippedReason,
        pushError: saved.pushError,
      });
    } catch (err) {
      result.skipped.push({
        scheduleId: ch.id,
        reason: `Channel ${ch.id}: ${err instanceof Error ? err.message : "failed"}`,
      });
    }
  }

  // --- 2) Push today's air day ---
  const { data: todaySchedules, error: tdErr } = await supabase
    .from("schedules")
    .select("id, channel_id, owner_id, schedule_date")
    .eq("schedule_date", today);

  if (tdErr) throw tdErr;

  for (const sched of todaySchedules ?? []) {
    const itemCount = await countScheduleItems(supabase, sched.id);
    if (itemCount === 0) continue;

    const { data: channel } = await supabase
      .from("channels")
      .select("settings")
      .eq("id", sched.channel_id)
      .single();

    const playout = parseChannelPlayoutSettings(channel?.settings);
    if (!playout.playout_active) continue;

    try {
      const push = await autoPushIfNeeded(
        supabase,
        sched.owner_id,
        sched.channel_id,
        sched.id,
        today,
        { insertGaps: true },
      );
      result.pushedToday.push({
        scheduleId: sched.id,
        channelId: sched.channel_id,
        pushed: push.pushed,
        reason: push.reason,
      });
    } catch (err) {
      result.pushedToday.push({
        scheduleId: sched.id,
        channelId: sched.channel_id,
        pushed: false,
        error: err instanceof Error ? err.message : "Push failed",
      });
    }
  }

  return result;
}
