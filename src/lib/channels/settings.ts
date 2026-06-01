import type { Json } from "@/integrations/supabase/types";

export type ChannelPlayoutSettings = {
  playout_active: boolean;
  /** Stays on until user turns off; cron fills the weekly horizon. */
  autopilot_enabled: boolean;
  /** How many calendar days to maintain (default 7). */
  autopilot_week_days: number;
  last_mist_push_at: string | null;
  last_mist_push_error: string | null;
  last_mist_push_schedule_id: string | null;
  autopilot_last_run_at: string | null;
};

const defaults: ChannelPlayoutSettings = {
  playout_active: false,
  autopilot_enabled: false,
  autopilot_week_days: 7,
  last_mist_push_at: null,
  last_mist_push_error: null,
  last_mist_push_schedule_id: null,
  autopilot_last_run_at: null,
};

export function parseChannelPlayoutSettings(settings: Json | null | undefined): ChannelPlayoutSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ...defaults };
  }
  const s = settings as Record<string, unknown>;
  const weekDays = typeof s.autopilot_week_days === "number" ? s.autopilot_week_days : 7;
  return {
    playout_active: s.playout_active === true,
    autopilot_enabled: s.autopilot_enabled === true,
    autopilot_week_days: weekDays >= 1 && weekDays <= 14 ? Math.floor(weekDays) : 7,
    last_mist_push_at: typeof s.last_mist_push_at === "string" ? s.last_mist_push_at : null,
    last_mist_push_error:
      typeof s.last_mist_push_error === "string"
        ? s.last_mist_push_error
        : s.last_mist_push_error === null
          ? null
          : null,
    last_mist_push_schedule_id:
      typeof s.last_mist_push_schedule_id === "string" ? s.last_mist_push_schedule_id : null,
    autopilot_last_run_at:
      typeof s.autopilot_last_run_at === "string" ? s.autopilot_last_run_at : null,
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
    autopilot_enabled: patch.autopilot_enabled ?? current.autopilot_enabled,
    autopilot_week_days: patch.autopilot_week_days ?? current.autopilot_week_days,
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
    autopilot_last_run_at:
      patch.autopilot_last_run_at !== undefined
        ? patch.autopilot_last_run_at
        : current.autopilot_last_run_at,
  };
}

/** Calendar date (yyyy-MM-dd) that should trigger a live Mist push when playout is active. */
export function isAirDateToday(scheduleDate: string, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  return scheduleDate === today;
}
