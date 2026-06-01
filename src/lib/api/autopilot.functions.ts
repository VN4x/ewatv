import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAutopilotJobs } from "@/lib/schedule/autopilot-cron.server";
import { generateAutopilotScheduleItems } from "@/lib/schedule/autopilot-generate.server";
import { persistScheduleAndPush } from "@/lib/schedule/persist-schedule.server";
import { getTomorrowInAutopilotTz } from "@/lib/schedule/timezone.server";

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

/**
 * Called by VPS cron / GitHub Actions / Supabase scheduled hook.
 * Requires AUTOPILOT_CRON_SECRET via Authorization: Bearer or X-Cron-Secret.
 */
export const runAutopilotCron = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      secret: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const secret = data.secret ?? readCronSecretFromRequest();
    assertCronSecret(secret);
    return runAutopilotJobs(supabaseAdmin);
  });

/** Logged-in manual run (same job, scoped preview for one channel optional). */
export const runAutopilotNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      channelId: z.string().uuid().optional(),
      /** yyyy-MM-dd; default = tomorrow in autopilot TZ */
      targetDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const targetDate = data.targetDate ?? getTomorrowInAutopilotTz();

    if (!data.channelId) {
      return runAutopilotJobs(context.supabase);
    }

    const { data: channel, error: chErr } = await context.supabase
      .from("channels")
      .select("id, owner_id")
      .eq("id", data.channelId)
      .single();

    if (chErr || !channel) throw new Error("Channel not found");
    if (channel.owner_id !== context.userId) throw new Error("Forbidden");

    const { data: sched, error: sErr } = await context.supabase
      .from("schedules")
      .upsert(
        {
          channel_id: data.channelId,
          schedule_date: targetDate,
          owner_id: context.userId,
          autopilot: true,
        },
        { onConflict: "channel_id,schedule_date" },
      )
      .select("id")
      .single();

    if (sErr || !sched) throw sErr ?? new Error("Schedule upsert failed");

    const items = await generateAutopilotScheduleItems(
      context.supabase,
      context.userId,
      targetDate,
    );

    const saved = await persistScheduleAndPush(context.supabase, context.userId, {
      channelId: data.channelId,
      scheduleDate: targetDate,
      autopilot: true,
      existingScheduleId: sched.id,
      items,
      insertGapsOnPush: true,
    });

    return { targetDate, ...saved, itemCount: items.length };
  });
