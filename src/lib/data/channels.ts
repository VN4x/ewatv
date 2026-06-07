import { supabase } from "@/integrations/supabase/client";
import { isPlayoutBackend } from "@/lib/playout-backend/config";
import { playoutApi, type Channel } from "@/lib/playout-backend/api";
import { mergePlayoutIntoSettings, type ChannelPlayoutSettings } from "@/lib/channels/settings";
import type { Json } from "@/integrations/supabase/types";

export async function getChannelBySlug(slug: string): Promise<Channel | null> {
  if (isPlayoutBackend()) {
    const items = await playoutApi.listChannels();
    return items.find((c) => c.slug === slug) ?? null;
  }
  const { data, error } = await supabase
    .from("channels")
    .select("id,name,slug,overlay_logo_url,fallback_youtube_url,settings,stream_name,timezone,playout_active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as Channel | null;
}

export async function createChannel(payload: {
  name: string;
  slug: string;
}): Promise<{ id: string; slug: string }> {
  if (isPlayoutBackend()) {
    const ch = await playoutApi.createChannel({
      name: payload.name,
      slug: payload.slug,
      playout_active: false,
    });
    return { id: ch.id, slug: ch.slug };
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not authenticated");
  const { data: dup } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", payload.slug)
    .maybeSingle();
  if (dup) throw new Error("Slug already in use");
  const { data, error } = await supabase
    .from("channels")
    .insert({ name: payload.name, slug: payload.slug, owner_id: u.user.id })
    .select("id,slug")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteChannel(id: string) {
  if (isPlayoutBackend()) return playoutApi.deleteChannel(id);
  const { data: scheds, error: e1 } = await supabase
    .from("schedules")
    .select("id")
    .eq("channel_id", id);
  if (e1) throw e1;
  const ids = (scheds ?? []).map((s) => s.id);
  if (ids.length > 0) {
    const { error: e2 } = await supabase.from("schedule_items").delete().in("schedule_id", ids);
    if (e2) throw e2;
    const { error: e3 } = await supabase.from("schedules").delete().in("id", ids);
    if (e3) throw e3;
  }
  const { error } = await supabase.from("channels").delete().eq("id", id);
  if (error) throw error;
}

export async function saveChannelSettings(
  channelId: string,
  patch: {
    name: string;
    slug: string;
    overlay_logo_url: string | null;
    fallback_youtube_url: string | null;
    settings: Json;
  },
) {
  if (isPlayoutBackend()) {
    return playoutApi.updateChannel(channelId, {
      name: patch.name,
      slug: patch.slug,
      overlay_logo_url: patch.overlay_logo_url,
      fallback_youtube_url: patch.fallback_youtube_url,
      settings: patch.settings,
    });
  }
  const { error } = await supabase.from("channels").update(patch).eq("id", channelId);
  if (error) throw error;
}

export async function isSlugTaken(slug: string, excludeChannelId?: string): Promise<boolean> {
  if (isPlayoutBackend()) {
    const items = await playoutApi.listChannels();
    return items.some((c) => c.slug === slug && c.id !== excludeChannelId);
  }
  let q = supabase.from("channels").select("id").eq("slug", slug);
  if (excludeChannelId) q = q.neq("id", excludeChannelId);
  const { data } = await q.maybeSingle();
  return Boolean(data);
}

export async function updateChannelPlayoutSettings(
  channelId: string,
  currentSettings: Json | null | undefined,
  patch: Partial<ChannelPlayoutSettings>,
  extra?: Record<string, unknown>,
) {
  const settings = mergePlayoutIntoSettings(currentSettings, patch);
  if (isPlayoutBackend()) {
    return playoutApi.updateChannel(channelId, { settings, ...extra });
  }
  const { error } = await supabase
    .from("channels")
    .update({ settings, ...extra })
    .eq("id", channelId);
  if (error) throw error;
}
