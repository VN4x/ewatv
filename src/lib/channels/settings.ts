import type { Json } from "@/integrations/supabase/types";

export const OVERLAY_ANCHORS = [
  "tl", "tc", "tr",
  "ml", "mc", "mr",
  "bl", "bc", "br",
] as const;
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number];

export type OverlayConfig = {
  id: string;
  name: string;
  url: string;
  anchor: OverlayAnchor;
  /** Horizontal nudge, % of viewport width (-50..50). Positive = right. */
  offsetXPct: number;
  /** Vertical nudge, % of viewport height (-50..50). Positive = down. */
  offsetYPct: number;
  /** Width as % of viewport width (1..50). Height = auto (preserves aspect). */
  widthPct: number;
  /** 0..1 */
  opacity: number;
  enabled: boolean;
};

export type OverlayPreset = {
  id: string;
  name: string;
  overlays: OverlayConfig[];
};

export type ChannelPlayoutSettings = {
  playout_active: boolean;
  autopilot_enabled: boolean;
  autopilot_week_days: number;
  autopilot_push_hour: number;
  transition_ms: number;
  overlays: OverlayConfig[];
  overlay_presets: OverlayPreset[];
  last_mist_push_at: string | null;
  last_mist_push_error: string | null;
  last_mist_push_schedule_id: string | null;
  autopilot_last_run_at: string | null;
};

export const DEFAULT_CHANNEL_TRANSITION_MS = 7000;
export const DEFAULT_AUTOPILOT_PUSH_HOUR = 4;
export const MAX_OVERLAYS = 6;
export const MAX_OVERLAY_PRESETS = 12;

const defaults: ChannelPlayoutSettings = {
  playout_active: false,
  autopilot_enabled: false,
  autopilot_week_days: 7,
  autopilot_push_hour: DEFAULT_AUTOPILOT_PUSH_HOUR,
  transition_ms: DEFAULT_CHANNEL_TRANSITION_MS,
  overlays: [],
  overlay_presets: [],
  last_mist_push_at: null,
  last_mist_push_error: null,
  last_mist_push_schedule_id: null,
  autopilot_last_run_at: null,
};

function clampTransition(ms: unknown): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_CHANNEL_TRANSITION_MS;
  return Math.max(0, Math.min(60000, Math.floor(ms)));
}

function clampHour(h: unknown): number {
  if (typeof h !== "number" || !Number.isFinite(h)) return DEFAULT_AUTOPILOT_PUSH_HOUR;
  return Math.max(0, Math.min(23, Math.floor(h)));
}

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function defaultOverlay(partial: Partial<OverlayConfig> = {}): OverlayConfig {
  return {
    id: crypto.randomUUID(),
    name: "Logo",
    url: "",
    anchor: "tl",
    offsetXPct: 2,
    offsetYPct: 2,
    widthPct: 8,
    opacity: 0.9,
    enabled: true,
    ...partial,
  };
}

function parseOverlay(raw: unknown): OverlayConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  if (!url) return null;
  const anchor = (typeof o.anchor === "string" && (OVERLAY_ANCHORS as readonly string[]).includes(o.anchor))
    ? (o.anchor as OverlayAnchor)
    : "tl";
  return {
    id: typeof o.id === "string" ? o.id : crypto.randomUUID(),
    name: typeof o.name === "string" ? o.name : "Logo",
    url,
    anchor,
    offsetXPct: clampNum(o.offsetXPct, -50, 50, 2),
    offsetYPct: clampNum(o.offsetYPct, -50, 50, 2),
    widthPct: clampNum(o.widthPct, 1, 50, 8),
    opacity: clampNum(o.opacity, 0, 1, 0.9),
    enabled: o.enabled !== false,
  };
}

export function parseChannelPlayoutSettings(settings: Json | null | undefined): ChannelPlayoutSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ...defaults, overlays: [] };
  }
  const s = settings as Record<string, unknown>;
  const weekDays = typeof s.autopilot_week_days === "number" ? s.autopilot_week_days : 7;
  const overlaysRaw = Array.isArray(s.overlays) ? s.overlays : [];
  const overlays = overlaysRaw
    .map(parseOverlay)
    .filter((o): o is OverlayConfig => o !== null)
    .slice(0, MAX_OVERLAYS);
  const presetsRaw = Array.isArray(s.overlay_presets) ? s.overlay_presets : [];
  const overlay_presets = presetsRaw
    .map(parsePreset)
    .filter((p): p is OverlayPreset => p !== null)
    .slice(0, MAX_OVERLAY_PRESETS);
  return {
    playout_active: s.playout_active === true,
    autopilot_enabled: s.autopilot_enabled === true,
    autopilot_week_days: weekDays >= 1 && weekDays <= 14 ? Math.floor(weekDays) : 7,
    autopilot_push_hour: clampHour(s.autopilot_push_hour),
    transition_ms: clampTransition(s.transition_ms),
    overlays,
    overlay_presets,
    last_mist_push_at: typeof s.last_mist_push_at === "string" ? s.last_mist_push_at : null,
    last_mist_push_error:
      typeof s.last_mist_push_error === "string" ? s.last_mist_push_error : null,
    last_mist_push_schedule_id:
      typeof s.last_mist_push_schedule_id === "string" ? s.last_mist_push_schedule_id : null,
    autopilot_last_run_at:
      typeof s.autopilot_last_run_at === "string" ? s.autopilot_last_run_at : null,
  };
}

function parsePreset(raw: unknown): OverlayPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (!name) return null;
  const overlaysRaw = Array.isArray(p.overlays) ? p.overlays : [];
  const overlays = overlaysRaw
    .map(parseOverlay)
    .filter((o): o is OverlayConfig => o !== null)
    .slice(0, MAX_OVERLAYS);
  return {
    id: typeof p.id === "string" ? p.id : crypto.randomUUID(),
    name: name.slice(0, 60),
    overlays,
  };
}

export function mergePlayoutIntoSettings(
  settings: Json | null | undefined,
  patch: Partial<ChannelPlayoutSettings>,
): Json {
  const base =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) }
      : {};
  const current = parseChannelPlayoutSettings(settings);
  const overlays = (patch.overlays ?? current.overlays)
    .map((o) => parseOverlay(o))
    .filter((o): o is OverlayConfig => o !== null)
    .slice(0, MAX_OVERLAYS);
  const merged: Record<string, unknown> = {
    ...base,
    playout_active: patch.playout_active ?? current.playout_active,
    autopilot_enabled: patch.autopilot_enabled ?? current.autopilot_enabled,
    autopilot_week_days: patch.autopilot_week_days ?? current.autopilot_week_days,
    autopilot_push_hour:
      patch.autopilot_push_hour !== undefined ? clampHour(patch.autopilot_push_hour) : current.autopilot_push_hour,
    transition_ms:
      patch.transition_ms !== undefined ? clampTransition(patch.transition_ms) : current.transition_ms,
    overlays: overlays as unknown as Json,
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
  return merged as Json;
}

/** Resolve overlays from settings, falling back to a single default overlay from a legacy logo URL. */
export function resolveOverlays(
  settings: Json | null | undefined,
  legacyLogoUrl: string | null | undefined,
): OverlayConfig[] {
  const parsed = parseChannelPlayoutSettings(settings);
  if (parsed.overlays.length > 0) return parsed.overlays.filter((o) => o.enabled && o.url);
  if (legacyLogoUrl) return [defaultOverlay({ url: legacyLogoUrl })];
  return [];
}

export function isAirDateToday(scheduleDate: string, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  return scheduleDate === today;
}
