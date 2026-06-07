import { useQuery } from "@tanstack/react-query";
import { nowPlaying, type NowPlayingResult } from "@/lib/api/playout.functions";
import { isPlayoutBackend, playoutApiBase } from "@/lib/playout-backend/config";
import { playoutApi } from "@/lib/playout-backend/api";
import type { OverlayConfig } from "@/lib/channels/settings";

export function useNowPlaying(opts: { channelId?: string; channelSlug?: string; intervalMs?: number }) {
  const { channelId, channelSlug, intervalMs = 3000 } = opts;
  const playout = isPlayoutBackend();

  return useQuery<NowPlayingResult>({
    queryKey: ["now-playing", channelId ?? channelSlug, playout ? "go" : "legacy"],
    enabled: Boolean(channelId || channelSlug),
    refetchInterval: intervalMs,
    queryFn: async () => {
      if (playout && channelSlug) {
        const raw = await playoutApi.nowPlaying(channelSlug);
        return mapGoNowPlaying(raw);
      }
      return nowPlaying({
        data: channelId ? { channelId } : { channelSlug: channelSlug! },
      }) as Promise<NowPlayingResult>;
    },
  });
}

function mapGoNowPlaying(raw: Record<string, unknown>): NowPlayingResult {
  const hlsBase = import.meta.env.VITE_PLAYOUT_HLS_BASE ?? `${playoutApiBase()}/hls`;
  const slug = String(raw.channelSlug ?? raw.channel_slug ?? "");
  return {
    streamName: String(raw.streamName ?? slug),
    hlsUrl: String(raw.hlsUrl ?? `${hlsBase.replace(/\/$/, "")}/${slug}/index.m3u8`),
    fallbackYoutubeUrl: (raw.fallbackYoutubeUrl as string | null) ?? null,
    channelName: String(raw.channelName ?? ""),
    channelSlug: slug,
    overlayLogoUrl: (raw.overlayLogoUrl as string | null) ?? null,
    overlays: (raw.overlays as OverlayConfig[]) ?? [],
    current: raw.current as NowPlayingResult["current"],
    next: raw.next as NowPlayingResult["next"],
  };
}
