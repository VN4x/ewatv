import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { mergePlayoutIntoSettings, parseChannelPlayoutSettings } from "@/lib/channels/settings";
import { generateAutopilotScheduleItems } from "@/lib/schedule/autopilot-generate.server";
import { persistScheduleAndPush } from "@/lib/schedule/persist-schedule.server";
import {
  getAutopilotTimezone,
  getAutopilotWeekDays,
  getTodayInAutopilotTz,
  getWeeklyScheduleDates,
  hourInTz,
} from "@/lib/schedule/timezone.server";
import { autoPushIfNeeded, pushTodayAirScheduleForChannel } from "@/lib/mist/push-schedule.server";

export type AutopilotJobResult = {
  timezone: string;
  today: string;
  weekDates: string[];
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
  skipped: Array<{ channelId: string; scheduleDate?: string; reason: string }>;
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

async function ensureScheduleRow(
  supabase: SupabaseClient<Database>,
  channelId: string,
  ownerId: string,
  scheduleDate: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("schedules")
    .select("id")
    .eq("channel_id", channelId)
    .eq("schedule_date", scheduleDate)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("schedules")
      .update({ autopilot: true })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: ins, error } = await supabase
    .from("schedules")
    .insert({
      channel_id: channelId,
      schedule_date: scheduleDate,
      owner_id: ownerId,
      autopilot: true,
    })
    .select("id")
    .single();

  if (error || !ins) throw error ?? new Error("Failed to create schedule row");
  return ins.id;
}

export type WeeklyGenerateResult = {
  generated: AutopilotJobResult["generated"];
  skipped: AutopilotJobResult["skipped"];
};

/** Fill empty days in the weekly horizon for one channel (does not overwrite days with items). */
export async function generateWeeklySchedulesForChannel(
  supabase: SupabaseClient<Database>,
  channelId: string,
  ownerId: string,
  weekDays?: number,
): Promise<WeeklyGenerateResult> {
  const dates = getWeeklyScheduleDates(new Date(), weekDays);
  const generated: WeeklyGenerateResult["generated"] = [];
  const skipped: WeeklyGenerateResult["skipped"] = [];

  for (const scheduleDate of dates) {
    try {
      const schedId = await ensureScheduleRow(supabase, channelId, ownerId, scheduleDate);
      const itemCount = await countScheduleItems(supabase, schedId);
      if (itemCount > 0) {
        skipped.push({
          channelId,
          scheduleDate,
          reason: `Already has ${itemCount} items (manual or prior autopilot)`,
        });
        continue;
      }

      const items = await generateAutopilotScheduleItems(supabase, ownerId, scheduleDate);
      const saved = await persistScheduleAndPush(supabase, ownerId, {
        channelId,
        scheduleDate,
        autopilot: true,
        existingScheduleId: schedId,
        items,
        insertGapsOnPush: true,
      });

      generated.push({
        scheduleId: saved.scheduleId,
        channelId,
        scheduleDate,
        itemCount: items.length,
        pushed: saved.pushed,
        pushSkippedReason: saved.pushSkippedReason,
        pushError: saved.pushError,
      });
    } catch (err) {
      skipped.push({
        channelId,
        scheduleDate,
        reason: err instanceof Error ? err.message : "Generate failed",
      });
    }
  }

  return { generated, skipped };
}

/**
 * Daily autopilot job:
 * 1) For each channel with **autopilot_enabled**, fill the next 7 days (empty slots only).
 * 2) Push **today** to Mist when playout_active.
 */
export async function runAutopilotJobs(
  supabase: SupabaseClient<Database>,
): Promise<AutopilotJobResult> {
  const tz = getAutopilotTimezone();
  const today = getTodayInAutopilotTz();
  const weekDates = getWeeklyScheduleDates();
  const currentHour = hourInTz(new Date(), tz);

  const result: AutopilotJobResult = {
    timezone: tz,
    today,
    weekDates,
    generated: [],
    pushedToday: [],
    skipped: [],
  };

  const { data: channels, error: chErr } = await supabase
    .from("channels")
    .select("id, owner_id, settings");

  if (chErr) throw chErr;

  for (const ch of channels ?? []) {
    const settings = parseChannelPlayoutSettings(ch.settings);
    if (!settings.autopilot_enabled) continue;
    if (settings.autopilot_push_hour !== currentHour) {
      result.skipped.push({
        channelId: ch.id,
        reason: `Push hour ${settings.autopilot_push_hour} != current hour ${currentHour} (${tz})`,
      });
      continue;
    }

    const weekResult = await generateWeeklySchedulesForChannel(
      supabase,
      ch.id,
      ch.owner_id,
      settings.autopilot_week_days,
    );
    result.generated.push(...weekResult.generated);
    result.skipped.push(...weekResult.skipped);

    if (settings.playout_active) {
      const todayPush = await pushTodayAirScheduleForChannel(supabase, ch.id, ch.owner_id);
      result.pushedToday.push({
        scheduleId: todayPush.scheduleId ?? ch.id,
        channelId: ch.id,
        pushed: todayPush.pushed,
        reason: todayPush.reason ?? "After weekly autopilot fill",
      });
    }

    await supabase
      .from("channels")
      .update({
        settings: mergePlayoutIntoSettings(ch.settings, {
          autopilot_last_run_at: new Date().toISOString(),
        }),
      })
      .eq("id", ch.id);
  }

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
