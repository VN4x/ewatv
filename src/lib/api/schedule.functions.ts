import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mergePlayoutIntoSettings, parseChannelPlayoutSettings } from "@/lib/channels/settings";
import {
  autoPushIfNeeded,
  executePushScheduleToMist,
  recordMistPushStatus,
} from "@/lib/mist/push-schedule.server";

const scheduleItemInput = z.object({
  video_id: z.string().uuid(),
  duration_ms: z.number().int().min(0),
  transition_ms: z.number().int().min(0),
  start_at: z.string().datetime(),
  source_snapshot: z.record(z.unknown()),
});

export const saveScheduleAndPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      channelId: z.string().uuid(),
      scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      autopilot: z.boolean(),
      existingScheduleId: z.string().uuid().optional(),
      items: z.array(scheduleItemInput),
      insertGapsOnPush: z.boolean().optional().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;

    let schedId = data.existingScheduleId;
    if (!schedId) {
      const { data: ins, error } = await context.supabase
        .from("schedules")
        .insert({
          channel_id: data.channelId,
          schedule_date: data.scheduleDate,
          autopilot: data.autopilot,
          owner_id: uid,
        })
        .select("id")
        .single();
      if (error) throw error;
      schedId = ins.id;
    } else {
      const { error } = await context.supabase
        .from("schedules")
        .update({ autopilot: data.autopilot })
        .eq("id", schedId)
        .eq("owner_id", uid);
      if (error) throw error;
    }

    const { error: delErr } = await context.supabase
      .from("schedule_items")
      .delete()
      .eq("schedule_id", schedId);
    if (delErr) throw delErr;

    if (data.items.length > 0) {
      const rows = data.items.map((it, i) => ({
        schedule_id: schedId!,
        owner_id: uid,
        video_id: it.video_id,
        position: i,
        start_at: it.start_at,
        duration_ms: it.duration_ms,
        transition_ms: it.transition_ms,
        source_snapshot: it.source_snapshot,
      }));
      const { error: insErr } = await context.supabase.from("schedule_items").insert(rows);
      if (insErr) throw insErr;
    }

    let push: Awaited<ReturnType<typeof autoPushIfNeeded>> = {
      pushed: false,
      reason: data.items.length === 0 ? "Schedule has no items" : undefined,
    };

    if (data.items.length > 0) {
      try {
        push = await autoPushIfNeeded(
          context.supabase,
          uid,
          data.channelId,
          schedId,
          data.scheduleDate,
          { insertGaps: data.insertGapsOnPush },
        );
      } catch (err) {
        return {
          scheduleId: schedId,
          saved: true,
          pushed: false,
          pushError: err instanceof Error ? err.message : "Mist push failed",
        };
      }
    }

    return {
      scheduleId: schedId,
      saved: true,
      pushed: push.pushed,
      pushSkippedReason: push.reason,
      pushResult: push.result,
    };
  });

export const updateChannelPlayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      channelId: z.string().uuid(),
      playoutActive: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: channel, error } = await context.supabase
      .from("channels")
      .select("id, settings, owner_id")
      .eq("id", data.channelId)
      .single();

    if (error || !channel) throw new Error("Channel not found");
    if (channel.owner_id !== context.userId) throw new Error("Forbidden");

    const merged = mergePlayoutIntoSettings(channel.settings, {
      playout_active: data.playoutActive,
    });

    const { error: upErr } = await context.supabase
      .from("channels")
      .update({ settings: merged })
      .eq("id", data.channelId);

    if (upErr) throw upErr;

    return {
      playout: parseChannelPlayoutSettings(merged),
    };
  });

export const retryPushScheduleToMist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      scheduleId: z.string().uuid(),
      insertGaps: z.boolean().optional().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: schedule, error } = await context.supabase
      .from("schedules")
      .select("id, channel_id, owner_id")
      .eq("id", data.scheduleId)
      .single();

    if (error || !schedule) throw new Error("Schedule not found");
    if (schedule.owner_id !== context.userId) throw new Error("Forbidden");

    try {
      const result = await executePushScheduleToMist(
        context.supabase,
        context.userId,
        data.scheduleId,
        { insertGaps: data.insertGaps },
      );
      await recordMistPushStatus(context.supabase, schedule.channel_id, context.userId, {
        success: true,
        scheduleId: data.scheduleId,
      });
      return { ok: true as const, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mist push failed";
      await recordMistPushStatus(context.supabase, schedule.channel_id, context.userId, {
        success: false,
        scheduleId: data.scheduleId,
        errorMessage: message,
      });
      throw err;
    }
  });
