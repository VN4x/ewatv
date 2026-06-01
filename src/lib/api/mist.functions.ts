import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMistConfig, isMistConfigured } from "@/lib/mist/config.server";
import {
  executePushScheduleToMist,
  recordMistPushStatus,
} from "@/lib/mist/push-schedule.server";
import { parseMegaSourceRef, signMegaObjectKey } from "@/lib/mist/sign-mega.server";

const pushInput = z.object({
  scheduleId: z.string().uuid(),
  insertGaps: z.boolean().optional().default(true),
  gapMs: z.number().int().min(500).max(10000).optional(),
  allowDirectUrlSmoke: z.boolean().optional().default(false),
});

export const getMistPlayoutConfig = createServerFn({ method: "GET" }).handler(async () => {
  const cfg = getMistConfig();
  return {
    configured: isMistConfigured(),
    publicHlsBase: cfg.publicHlsBase,
    playlistSyncUrl: cfg.playlistSyncUrl ? "(set)" : null,
    defaultGapMs: cfg.defaultGapMs,
    gapAssetPath: cfg.gapAssetPath,
  };
});

export const signMegaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: video, error } = await context.supabase
      .from("videos")
      .select("id, source_type, source_ref, owner_id")
      .eq("id", data.videoId)
      .single();

    if (error || !video) throw new Error("Video not found");
    if (video.owner_id !== context.userId) throw new Error("Forbidden");
    if (video.source_type !== "mega_s3") {
      throw new Error(`signMegaUrl only supports mega_s3, got ${video.source_type}`);
    }

    const { key } = parseMegaSourceRef(video.source_ref);
    const signed = await signMegaObjectKey(key);
    return { videoId: video.id, url: signed.url, expiresInSec: signed.expiresInSec };
  });

export const pushScheduleToMist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pushInput)
  .handler(async ({ data, context }) => {
    const { data: schedule } = await context.supabase
      .from("schedules")
      .select("channel_id")
      .eq("id", data.scheduleId)
      .single();

    const result = await executePushScheduleToMist(
      context.supabase,
      context.userId,
      data.scheduleId,
      {
        insertGaps: data.insertGaps,
        gapMs: data.gapMs,
        allowDirectUrlSmoke: data.allowDirectUrlSmoke,
      },
    );

    if (schedule?.channel_id) {
      await recordMistPushStatus(context.supabase, schedule.channel_id, context.userId, {
        success: true,
        scheduleId: data.scheduleId,
      });
    }

    return {
      mode: result.mode,
      streamName: result.streamName,
      hlsUrl: result.hlsUrl,
      plsPreview: result.plsPreview,
      itemCount: result.itemCount,
      syncResult: result.syncResult,
      mistResponse: result.mistResponse,
    };
  });

export const createSmokeSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      channelId: z.string().uuid(),
      videoId: z.string().uuid(),
      includeGapAfter: z.boolean().optional().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const today = new Date().toISOString().slice(0, 10);

    const { data: schedule, error: upsertErr } = await context.supabase
      .from("schedules")
      .upsert(
        {
          channel_id: data.channelId,
          schedule_date: today,
          owner_id: context.userId,
          autopilot: false,
        },
        { onConflict: "channel_id,schedule_date" },
      )
      .select("id")
      .single();

    if (upsertErr || !schedule) throw upsertErr ?? new Error("Failed to create schedule");

    await context.supabase.from("schedule_items").delete().eq("schedule_id", schedule.id);

    const { data: video } = await context.supabase
      .from("videos")
      .select("id, title, length_sec, source_type, source_ref")
      .eq("id", data.videoId)
      .single();

    if (!video) throw new Error("Video not found");

    const durationMs = Math.max(video.length_sec, 1) * 1000;
    const { error: insertErr } = await context.supabase.from("schedule_items").insert({
      schedule_id: schedule.id,
      owner_id: context.userId,
      position: 0,
      start_at: new Date().toISOString(),
      duration_ms: durationMs,
      transition_ms: 0,
      video_id: video.id,
      source_snapshot: {
        title: video.title,
        source_type: video.source_type,
        source_ref: video.source_ref,
      },
    });
    if (insertErr) throw insertErr;

    if (data.includeGapAfter) {
      const gapMs = getMistConfig().defaultGapMs;
      const gapStart = new Date(Date.now() + durationMs).toISOString();
      const { error: gapErr } = await context.supabase.from("schedule_items").insert({
        schedule_id: schedule.id,
        owner_id: context.userId,
        position: 1,
        start_at: gapStart,
        duration_ms: gapMs,
        transition_ms: 0,
        video_id: null,
        source_snapshot: {
          kind: "gap",
          duration_ms: gapMs,
          show_logo: true,
        },
      });
      if (gapErr) throw gapErr;
    }

    return {
      scheduleId: schedule.id,
      itemCount: data.includeGapAfter ? 2 : 1,
    };
  });
