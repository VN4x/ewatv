import type { Json } from "@/integrations/supabase/types";

export type ChannelPlayoutSettings = {
  playout_active: boolean;
  last_mist_push_at: string | null;
  last_mist_push_error: string | null;
  last_mist_push_schedule_id: string | null;
};

const defaults: ChannelPlayoutSettings = {
  playout_active: false,
  last_mist_push_at: null,
  last_mist_push_error: null,
  last_mist_push_schedule_id: null,
};

export function parseChannelPlayoutSettings(settings: Json | null | undefined): ChannelPlayoutSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ...defaults };
  }
  const s = settings as Record<string, unknown>;
  return {
    playout_active: s.playout_active === true,
    last_mist_push_at: typeof s.last_mist_push_at === "string" ? s.last_mist_push_at : null,
    last_mist_push_error:
      typeof s.last_mist_push_error === "string"
        ? s.last_mist_push_error
        : s.last_mist_push_error === null
          ? null
          : null,
    last_mist_push_schedule_id:
      typeof s.last_mist_push_schedule_id === "string" ? s.last_mist_push_schedule_id : null,
  };
}

export function mergePlayoutIntoSettings(
  settings: Json | null | undefined,
  patch: Partial<ChannelPlayoutSettings>,
): Record<string, unknown> {
  const base =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) }
      : {};
  const current = parseChannelPlayoutSettings(settings);
  return {
    ...base,
    playout_active: patch.playout_active ?? current.playout_active,
    last_mist_push_at:
      patch.last_mist_push_at !== undefined ? patch.last_mist_push_at : current.last_mist_push_at,
    last_mist_push_error:
      patch.last_mist_push_error !== undefined
        ? patch.last_mist_push_error
        : current.last_mist_push_error,
    last_mist_push_schedule_id:
      patch.last_mist_push_schedule_id !== undefined
        ? patch.last_mist_push_schedule_id
        : current.last_mist_push_schedule_id,
  };
}

/** Calendar date (yyyy-MM-dd) that should trigger a live Mist push when playout is active. */
export function isAirDateToday(scheduleDate: string, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  return scheduleDate === today;
}
