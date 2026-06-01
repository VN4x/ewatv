import { useQuery } from "@tanstack/react-query";
import { nowPlaying, type NowPlayingResult } from "@/lib/api/playout.functions";

export function useNowPlaying(opts: { channelId?: string; channelSlug?: string; intervalMs?: number }) {
  const { channelId, channelSlug, intervalMs = 5000 } = opts;
  return useQuery<NowPlayingResult>({
    queryKey: ["now-playing", channelId ?? channelSlug],
    enabled: Boolean(channelId || channelSlug),
    refetchInterval: intervalMs,
    queryFn: () =>
      nowPlaying({
        data: channelId ? { channelId } : { channelSlug: channelSlug! },
      }) as Promise<NowPlayingResult>,
  });
}
