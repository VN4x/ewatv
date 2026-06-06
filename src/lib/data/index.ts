/**
 * Unified data layer — routes to Go playout backend or Supabase based on VITE_DATA_SOURCE.
 */
import { supabase } from "@/integrations/supabase/client";
import { isPlayoutBackend } from "@/lib/playout-backend/config";
import { playoutApi } from "@/lib/playout-backend/api";
import { sanitizeSearch } from "./search";

export { isPlayoutBackend };
export { sanitizeSearch };

export async function listCollections() {
  if (isPlayoutBackend()) return playoutApi.listCollections();
  const { data, error } = await supabase.from("collections").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listVideos(opts?: { collectionId?: string | null; search?: string }) {
  if (isPlayoutBackend()) {
    return playoutApi.listVideos({
      collection_id: opts?.collectionId ?? undefined,
      search: sanitizeSearch(opts?.search),
    });
  }
  let q = supabase.from("videos").select("*").order("created_at", { ascending: false });
  if (opts?.collectionId) q = q.eq("collection_id", opts.collectionId);
  const search = sanitizeSearch(opts?.search);
  if (search) {
    q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function deleteVideo(id: string) {
  if (isPlayoutBackend()) return playoutApi.deleteVideo(id);
  const { error } = await supabase.from("videos").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteCollection(id: string) {
  if (isPlayoutBackend()) return playoutApi.deleteCollection(id);
  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) throw error;
}

export async function insertCollection(payload: {
  name: string;
  description?: string | null;
  parent_id?: string | null;
  owner_id?: string;
}) {
  if (isPlayoutBackend()) {
    return playoutApi.createCollection({
      name: payload.name,
      description: payload.description ?? undefined,
      parent_id: payload.parent_id,
    });
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not authenticated");
  const { error } = await supabase.from("collections").insert({
    name: payload.name,
    description: payload.description,
    parent_id: payload.parent_id,
    owner_id: u.user.id,
  });
  if (error) throw error;
}

export async function upsertVideo(
  existing: { id: string } | null,
  payload: Record<string, unknown>,
) {
  if (isPlayoutBackend()) {
    if (existing) return playoutApi.updateVideo(existing.id, payload);
    return playoutApi.createVideo(payload);
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not authenticated");
  const row = { ...payload, owner_id: u.user.id };
  if (existing) {
    const { error } = await supabase.from("videos").update(row).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("videos").insert(row);
    if (error) throw error;
  }
}

export async function listChannels() {
  if (isPlayoutBackend()) return playoutApi.listChannels();
  const { data, error } = await supabase.from("channels").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function updateChannel(id: string, patch: Record<string, unknown>) {
  if (isPlayoutBackend()) return playoutApi.updateChannel(id, patch);
  const { error } = await supabase.from("channels").update(patch).eq("id", id);
  if (error) throw error;
}

export async function getSchedule(channelId: string, date: string) {
  if (isPlayoutBackend()) return playoutApi.getSchedule(channelId, date);
  const { data: sched } = await supabase
    .from("schedules")
    .select("id, channel_id, schedule_date, autopilot")
    .eq("channel_id", channelId)
    .eq("schedule_date", date)
    .maybeSingle();
  if (!sched) return null;
  const { data: items, error } = await supabase
    .from("schedule_items")
    .select("*")
    .eq("schedule_id", sched.id)
    .order("position");
  if (error) throw error;
  return { schedule: sched, items: items ?? [] };
}

export async function saveScheduleToBackend(
  channelId: string,
  date: string,
  body: Record<string, unknown>,
) {
  if (isPlayoutBackend()) return playoutApi.saveSchedule(channelId, date, body);
  throw new Error("Use saveScheduleAndPush server fn in Supabase mode");
}

export async function runAutopilotBackend(
  channelId: string,
  body: { days?: number; from_date?: string },
) {
  if (isPlayoutBackend()) return playoutApi.runAutopilot(channelId, body);
  throw new Error("Use runAutopilotNow server fn in Supabase mode");
}

export {
  getChannelBySlug,
  createChannel,
  deleteChannel,
  saveChannelSettings,
  isSlugTaken,
  updateChannelPlayoutSettings,
} from "./channels";

export { getPrevScheduleEnd, createEmptySchedule } from "./schedules";
