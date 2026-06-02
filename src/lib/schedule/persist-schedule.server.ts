import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { autoPushIfNeeded } from "@/lib/mist/push-schedule.server";

export type ScheduleItemPayload = {
  video_id: string;
  duration_ms: number;
  transition_ms: number;
  start_at: string;
  source_snapshot: Record<string, unknown>;
};

export type PersistScheduleInput = {
  channelId: string;
  scheduleDate: string;
  autopilot: boolean;
  existingScheduleId?: string;
  items: ScheduleItemPayload[];
  insertGapsOnPush?: boolean;
};

export type PersistScheduleResult = {
  scheduleId: string;
  saved: boolean;
  pushed: boolean;
  pushSkippedReason?: string;
  pushError?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pushResult?: any;
};

export async function persistScheduleAndPush(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: PersistScheduleInput,
): Promise<PersistScheduleResult> {
  let schedId = data.existingScheduleId;

  if (!schedId) {
    const { data: ins, error } = await supabase
      .from("schedules")
      .insert({
        channel_id: data.channelId,
        schedule_date: data.scheduleDate,
        autopilot: data.autopilot,
        owner_id: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    schedId = ins.id;
  } else {
    const { error } = await supabase
      .from("schedules")
      .update({ autopilot: data.autopilot })
      .eq("id", schedId)
      .eq("owner_id", userId);
    if (error) throw error;
  }

  const { error: delErr } = await supabase
    .from("schedule_items")
    .delete()
    .eq("schedule_id", schedId);
  if (delErr) throw delErr;

  if (data.items.length > 0) {
    const rows = data.items.map((it, i) => ({
      schedule_id: schedId!,
      owner_id: userId,
      video_id: it.video_id,
      position: i,
      start_at: it.start_at,
      duration_ms: it.duration_ms,
      transition_ms: it.transition_ms,
      source_snapshot: it.source_snapshot as Database["public"]["Tables"]["schedule_items"]["Insert"]["source_snapshot"],
    }));
    const { error: insErr } = await supabase.from("schedule_items").insert(rows);
    if (insErr) throw insErr;
  }

  if (data.items.length === 0) {
    return {
      scheduleId: schedId,
      saved: true,
      pushed: false,
      pushSkippedReason: "Schedule has no items",
    };
  }

  try {
    const push = await autoPushIfNeeded(
      supabase,
      userId,
      data.channelId,
      schedId,
      data.scheduleDate,
      { insertGaps: data.insertGapsOnPush ?? true },
    );
    return {
      scheduleId: schedId,
      saved: true,
      pushed: push.pushed,
      pushSkippedReason: push.reason,
      pushResult: push.result,
    };
  } catch (err) {
    return {
      scheduleId: schedId,
      saved: true,
      pushed: false,
      pushError: err instanceof Error ? err.message : "Mist push failed",
    };
  }
}
