import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  mergePlayoutIntoSettings,
  parseChannelPlayoutSettings,
} from "@/lib/channels/settings";
import {
  generateWeeklySchedulesForChannel,
  runAutopilotJobs,
} from "@/lib/schedule/autopilot-cron.server";
import { getWeeklyScheduleDates } from "@/lib/schedule/timezone.server";

function assertCronSecret(provided: string | undefined) {
  const expected = process.env.AUTOPILOT_CRON_SECRET;
  if (!expected) {
    throw new Error("AUTOPILOT_CRON_SECRET is not configured on the server");
  }
  if (!provided || provided !== expected) {
    throw new Error("Unauthorized cron request");
  }
}

function readCronSecretFromRequest(): string | undefined {
  const request = getRequest();
  if (!request?.headers) return undefined;
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7);
  return request.headers.get("x-cron-secret") ?? undefined;
}

export const runAutopilotCron = createServerFn({ method: "POST" })
  .inputValidator(z.object({ secret: z.string().optional() }))
  .handler(async ({ data }) => {
    const secret = data.secret ?? readCronSecretFromRequest();
    assertCronSecret(secret);
    return runAutopilotJobs(supabaseAdmin);
  });

/** Persist channel autopilot until user turns it off. */
export const updateChannelAutopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      channelId: z.string().uuid(),
      autopilotEnabled: z.boolean(),
      /** Optional; default 7 */
      weekDays: z.number().int().min(1).max(14).optional(),
      /** When enabling, immediately generate the weekly horizon */
      runNow: z.boolean().optional().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: channel, error } = await context.supabase
      .from("channels")
      .select("id, owner_id, settings")
      .eq("id", data.channelId)
      .single();

    if (error || !channel) throw new Error("Channel not found");
    if (channel.owner_id !== context.userId) throw new Error("Forbidden");

    const current = parseChannelPlayoutSettings(channel.settings);
    const merged = mergePlayoutIntoSettings(channel.settings, {
      autopilot_enabled: data.autopilotEnabled,
      autopilot_week_days: data.weekDays ?? current.autopilot_week_days,
    });

    const { error: upErr } = await context.supabase
      .from("channels")
      .update({ settings: merged })
      .eq("id", data.channelId);

    if (upErr) throw upErr;

    let weekly: Awaited<ReturnType<typeof generateWeeklySchedulesForChannel>> | undefined;
    if (data.autopilotEnabled && data.runNow) {
      weekly = await generateWeeklySchedulesForChannel(
        context.supabase,
        data.channelId,
        context.userId,
        data.weekDays ?? current.autopilot_week_days,
      );
      await context.supabase
        .from("channels")
        .update({
          settings: mergePlayoutIntoSettings(merged, {
            autopilot_last_run_at: new Date().toISOString(),
          }),
        })
        .eq("id", data.channelId);
    }

    return {
      settings: parseChannelPlayoutSettings(merged),
      weekDates: getWeeklyScheduleDates(),
      weekly,
    };
  });

/** Manual: refresh weekly horizon for one channel (or all autopilot channels). */
export const runAutopilotNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      channelId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (!data.channelId) {
      return runAutopilotJobs(context.supabase);
    }

    const { data: channel, error: chErr } = await context.supabase
      .from("channels")
      .select("id, owner_id, settings")
      .eq("id", data.channelId)
      .single();

    if (chErr || !channel) throw new Error("Channel not found");
    if (channel.owner_id !== context.userId) throw new Error("Forbidden");

    const settings = parseChannelPlayoutSettings(channel.settings);
    const weekly = await generateWeeklySchedulesForChannel(
      context.supabase,
      data.channelId,
      context.userId,
      settings.autopilot_week_days,
    );

    await context.supabase
      .from("channels")
      .update({
        settings: mergePlayoutIntoSettings(channel.settings, {
          autopilot_last_run_at: new Date().toISOString(),
        }),
      })
      .eq("id", data.channelId);

    return {
      weekDates: getWeeklyScheduleDates(undefined, settings.autopilot_week_days),
      ...weekly,
    };
  });
