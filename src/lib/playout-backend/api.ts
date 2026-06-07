import { playoutFetch } from "./client";
import type { PlayoutUser } from "./auth-store";

export type AuthResponse = {
  token: string;
  user: { id: string; email: string; role: string; display_name?: string | null };
};

export const playoutAuth = {
  register: (email: string, password: string, display_name?: string) =>
    playoutFetch<AuthResponse>("/v1/auth/register", {
      auth: false,
      body: { email, password, display_name },
    }),
  login: (email: string, password: string) =>
    playoutFetch<AuthResponse>("/v1/auth/login", {
      auth: false,
      body: { email, password },
    }),
  me: () => playoutFetch<PlayoutUser>("/v1/auth/me"),
};

export type Collection = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Video = {
  id: string;
  collection_id: string | null;
  title: string;
  description: string | null;
  length_sec: number;
  source_type: string;
  source_ref: string;
  pack_status?: string;
  tags: string[];
  category: string | null;
  daypart: string;
  hide_overlay: boolean;
  auto_subs: boolean;
  created_at?: string;
};

export type Channel = {
  id: string;
  name: string;
  slug: string;
  stream_name: string;
  timezone: string;
  overlay_logo_url: string | null;
  fallback_youtube_url: string | null;
  settings: Record<string, unknown>;
  playout_active: boolean;
};

export type ScheduleItem = {
  id: string;
  video_id: string | null;
  position: number;
  start_at: string;
  duration_ms: number;
  transition_ms: number;
  source_snapshot: Record<string, unknown>;
};

export type ScheduleView = {
  schedule: {
    id: string;
    channel_id: string;
    schedule_date: string;
    autopilot: boolean;
  };
  items: ScheduleItem[];
  conflicts?: unknown[];
};

export const playoutApi = {
  listCollections: () =>
    playoutFetch<{ items: Collection[] }>("/v1/collections").then((r) => r.items),

  createCollection: (body: { name: string; description?: string; parent_id?: string | null }) =>
    playoutFetch<Collection>("/v1/collections", { method: "POST", body }),

  updateCollection: (id: string, body: Partial<{ name: string; description: string | null; parent_id: string | null }>) =>
    playoutFetch<Collection>(`/v1/collections/${id}`, { method: "PATCH", body }),

  deleteCollection: (id: string) =>
    playoutFetch<void>(`/v1/collections/${id}`, { method: "DELETE" }),

  listVideos: (params?: { collection_id?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.collection_id) q.set("collection_id", params.collection_id);
    if (params?.search) q.set("search", params.search);
    const qs = q.toString();
    return playoutFetch<{ items: Video[] }>(`/v1/videos${qs ? `?${qs}` : ""}`).then((r) => r.items);
  },

  createVideo: (body: Record<string, unknown>) =>
    playoutFetch<Video>("/v1/videos", { method: "POST", body }),

  updateVideo: (id: string, body: Record<string, unknown>) =>
    playoutFetch<Video>(`/v1/videos/${id}`, { method: "PATCH", body }),

  deleteVideo: (id: string) =>
    playoutFetch<void>(`/v1/videos/${id}`, { method: "DELETE" }),

  listChannels: () =>
    playoutFetch<{ items: Channel[] }>("/v1/channels").then((r) => r.items),

  createChannel: (body: Record<string, unknown>) =>
    playoutFetch<Channel>("/v1/channels", { method: "POST", body }),

  updateChannel: (id: string, body: Record<string, unknown>) =>
    playoutFetch<Channel>(`/v1/channels/${id}`, { method: "PATCH", body }),

  deleteChannel: (id: string) =>
    playoutFetch<void>(`/v1/channels/${id}`, { method: "DELETE" }),

  listSchedules: (channelId: string) =>
    playoutFetch<{ items: { id: string; schedule_date: string }[] }>(
      `/v1/channels/${channelId}/schedules`,
    ).then((r) => r.items),

  getSchedule: (channelId: string, date: string) =>
    playoutFetch<ScheduleView>(`/v1/channels/${channelId}/schedules/${date}`),

  saveSchedule: (channelId: string, date: string, body: Record<string, unknown>) =>
    playoutFetch<ScheduleView>(`/v1/channels/${channelId}/schedules/${date}`, {
      method: "PUT",
      body,
    }),

  runAutopilot: (channelId: string, body: { days?: number; from_date?: string }) =>
    playoutFetch<{ generated: unknown[]; skipped: unknown[] }>(
      `/v1/channels/${channelId}/autopilot/generate`,
      { method: "POST", body },
    ),

  nowPlaying: (slug: string) =>
    playoutFetch<Record<string, unknown>>(`/v1/channels/${slug}/now-playing`, { auth: false }),

  sessionStart: (body: { session_id: string; channel_slug: string }) =>
    playoutFetch<void>("/v1/events/session-start", { auth: false, body }),

  sessionHeartbeat: (body: { session_id: string; watch_ms?: number }) =>
    playoutFetch<void>("/v1/events/heartbeat", { auth: false, body }),

  sessionEnd: (body: { session_id: string; watch_ms?: number }) =>
    playoutFetch<void>("/v1/events/session-end", { auth: false, body }),

  analyticsLive: () =>
    playoutFetch<{ channels: LiveChannel[]; total_viewers: number }>("/v1/analytics/live"),

  analyticsSummary: (params?: { channel?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set("channel", params.channel);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return playoutFetch<AnalyticsSummary>(`/v1/analytics/summary${qs ? `?${qs}` : ""}`);
  },

  analyticsByHour: (params?: { channel?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set("channel", params.channel);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return playoutFetch<{ points: HourlyPoint[] }>(`/v1/analytics/by-hour${qs ? `?${qs}` : ""}`);
  },

  analyticsByDow: (params?: { channel?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set("channel", params.channel);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return playoutFetch<{ points: DowPoint[] }>(`/v1/analytics/by-dow${qs ? `?${qs}` : ""}`);
  },

  analyticsByCountry: (params?: { channel?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set("channel", params.channel);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return playoutFetch<{ points: GeoPoint[] }>(`/v1/analytics/by-country${qs ? `?${qs}` : ""}`);
  },
};

export type LiveChannel = {
  channel_id: string;
  slug: string;
  name: string;
  viewers: number;
};

export type AnalyticsSummary = {
  unique_sessions: number;
  total_watch_ms: number;
  peak_concurrent: number;
};

export type HourlyPoint = {
  hour: string;
  sessions: number;
  total_watch_ms: number;
};

export type DowPoint = {
  day_of_week: number;
  total_watch_ms: number;
  sessions: number;
};

export type GeoPoint = {
  country_code: string;
  sessions: number;
  total_watch_ms: number;
};
