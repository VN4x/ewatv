import { supabase } from "@/integrations/supabase/client";
import { isPlayoutBackend } from "@/lib/playout-backend/config";
import { playoutApi } from "@/lib/playout-backend/api";
import { PlayoutApiError } from "@/lib/playout-backend/client";

/** Latest wall-clock end across all schedule items on a channel (excluding one schedule). */
export async function getPrevScheduleEnd(
  channelId: string,
  excludeScheduleId?: string | null,
): Promise<string | null> {
  if (isPlayoutBackend()) {
    const schedules = await playoutApi.listSchedules(channelId);
    let max = 0;
    for (const sched of schedules) {
      if (excludeScheduleId && sched.id === excludeScheduleId) continue;
      const view = await playoutApi.getSchedule(channelId, sched.schedule_date);
      for (const item of view.items ?? []) {
        const t =
          new Date(item.start_at).getTime() + item.duration_ms + item.transition_ms;
        if (t > max) max = t;
      }
    }
    return max ? new Date(max).toISOString() : null;
  }

  const { data: scheds, error } = await supabase
    .from("schedules")
    .select("id")
    .eq("channel_id", channelId);
  if (error) throw error;
  const ids = (scheds ?? [])
    .map((s) => s.id)
    .filter((id) => id !== excludeScheduleId);
  if (ids.length === 0) return null;
  const { data: rows, error: e2 } = await supabase
    .from("schedule_items")
    .select("start_at,duration_ms,transition_ms")
    .in("schedule_id", ids);
  if (e2) throw e2;
  let max = 0;
  for (const r of rows ?? []) {
    const t = new Date(r.start_at).getTime() + r.duration_ms + r.transition_ms;
    if (t > max) max = t;
  }
  return max ? new Date(max).toISOString() : null;
}

export async function createEmptySchedule(
  channelId: string,
  scheduleDate: string,
): Promise<{ id: string; alreadyExisted: boolean }> {
  if (isPlayoutBackend()) {
    try {
      const existing = await playoutApi.getSchedule(channelId, scheduleDate);
      if (existing?.schedule?.id) {
        return { id: existing.schedule.id, alreadyExisted: true };
      }
    } catch (e) {
      if (!(e instanceof PlayoutApiError && e.status === 404)) throw e;
    }
    const saved = await playoutApi.saveSchedule(channelId, scheduleDate, {
      autopilot: false,
      items: [],
      recompute_start_at: false,
    });
    return { id: saved.schedule.id, alreadyExisted: false };
  }

  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Not authenticated");
  const { data: existing } = await supabase
    .from("schedules")
    .select("id")
    .eq("channel_id", channelId)
    .eq("schedule_date", scheduleDate)
    .maybeSingle();
  if (existing) return { id: existing.id, alreadyExisted: true };
  const { data: ins, error } = await supabase
    .from("schedules")
    .insert({
      channel_id: channelId,
      schedule_date: scheduleDate,
      autopilot: false,
      owner_id: uid,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: ins.id, alreadyExisted: false };
}
