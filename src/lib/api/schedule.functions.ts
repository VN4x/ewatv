import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mergePlayoutIntoSettings, parseChannelPlayoutSettings } from "@/lib/channels/settings";
import {
  executePushScheduleToMist,
  recordMistPushStatus,
} from "@/lib/mist/push-schedule.server";
import { persistScheduleAndPush } from "@/lib/schedule/persist-schedule.server";

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
    return persistScheduleAndPush(context.supabase, context.userId, {
      channelId: data.channelId,
      scheduleDate: data.scheduleDate,
      autopilot: data.autopilot,
      existingScheduleId: data.existingScheduleId,
      items: data.items,
      insertGapsOnPush: data.insertGapsOnPush,
    });
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
