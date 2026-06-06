import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MonitorPlay, Radio, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  createSmokeSchedule, getMistPlayoutConfig, pushScheduleToMist,
} from "@/lib/api/mist.functions";
import { isPlayoutBackend, listChannels, listVideos, createChannel } from "@/lib/data";
import { playoutHlsBase } from "@/lib/playout-backend/config";
import { LinearPlayer, type LinearPlayerHandle } from "@/components/playout/LinearPlayer";
import { PlayoutOverlay } from "@/components/playout/PlayoutOverlay";
import { useNowPlaying } from "@/hooks/useNowPlaying";

export const Route = createFileRoute("/_authenticated/playout")({
  head: () => ({ meta: [{ title: "Playout — ewatv" }] }),
  component: PlayoutPage,
});

type Channel = {
  id: string;
  name: string;
  slug: string;
  overlay_logo_url: string | null;
};
type Video = { id: string; title: string };

function PlayoutPage() {
  const qc = useQueryClient();
  const playerRef = useRef<LinearPlayerHandle>(null);
  const [, force] = useState(0);
  const playout = isPlayoutBackend();

  const [channelId, setChannelId] = useState<string>("");
  const [videoId, setVideoId] = useState<string>("");
  const [insertGaps, setInsertGaps] = useState(true);
  const [directSmoke, setDirectSmoke] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<string>("");

  const { data: mistConfig } = useQuery({
    queryKey: ["mist-config"],
    queryFn: () => getMistPlayoutConfig(),
    enabled: !playout,
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const data = await listChannels();
      return data.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        overlay_logo_url: c.overlay_logo_url ?? null,
      })) as Channel[];
    },
  });

  const { data: videos = [] } = useQuery({
    queryKey: ["videos-picker"],
    queryFn: async () => {
      const data = await listVideos();
      return data
        .map((v) => ({ id: v.id, title: v.title }))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 50) as Video[];
    },
  });

  useEffect(() => {
    if (!channelId && channels[0]) setChannelId(channels[0].id);
    if (!videoId && videos[0]) setVideoId(videos[0].id);
  }, [channels, videos, channelId, videoId]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId),
    [channels, channelId],
  );

  const { data: now } = useNowPlaying({
    channelId: playout ? undefined : channelId || undefined,
    channelSlug: playout ? selectedChannel?.slug : undefined,
  });

  useEffect(() => {
    queueMicrotask(() => force((n) => n + 1));
  }, [now?.hlsUrl]);

  const ensureChannel = useMutation({
    mutationFn: async () => {
      const existing = channels[0];
      if (existing) return existing.id;
      const created = await createChannel({ name: "TV1", slug: "tv1" });
      return created.id;
    },
    onSuccess: (id) => {
      if (id) {
        qc.invalidateQueries({ queryKey: ["channels"] });
        setChannelId(id);
        toast.success("Default channel ready (tv1)");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create channel"),
  });

  const smokeSchedule = useMutation({
    mutationFn: async () => {
      if (!channelId || !videoId) throw new Error("Select channel and video");
      if (playout) throw new Error("Use Schedules to build today's lineup in playout mode");
      return createSmokeSchedule({ data: { channelId, videoId, includeGapAfter: insertGaps } });
    },
    onSuccess: (res) => {
      setScheduleId(res.scheduleId);
      toast.success(`Smoke schedule created (${res.itemCount} items)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Schedule failed"),
  });

  const pushMist = useMutation({
    mutationFn: async () => {
      if (playout) throw new Error("Mist push is not used in playout mode");
      if (!scheduleId) throw new Error("Create a smoke schedule first");
      return pushScheduleToMist({
        data: { scheduleId, insertGaps, allowDirectUrlSmoke: directSmoke },
      });
    },
    onSuccess: (res) => {
      const r = res as { mode: string; hlsUrl?: string | null };
      setPushResult(JSON.stringify(res, null, 2));
      toast.success(`Pushed to Mist (${r.mode})`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Push failed"),
  });

  const streamConfigured = playout
    ? Boolean(playoutHlsBase())
    : Boolean(mistConfig?.publicHlsBase);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Playout</h1>
          <p className="text-sm text-muted-foreground">
            Live operator view. Stream + DB-driven now/next + channel logo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Channel</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name} ({c.slug})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedChannel && (
            <Link
              to="/playout/$channelSlug"
              params={{ channelSlug: selectedChannel.slug }}
              target="_blank"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Public view ↗
            </Link>
          )}
        </div>
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-border">
        <LinearPlayer
          ref={playerRef}
          hlsUrl={now?.hlsUrl ?? null}
          fallbackYoutubeUrl={now?.fallbackYoutubeUrl ?? null}
          className="absolute inset-0 h-full w-full"
          onError={(e) => toast.error(e)}
        />
        <PlayoutOverlay
          videoEl={playerRef.current?.video ?? null}
          now={now}
          overlays={now?.overlays}
          logoUrl={now?.overlayLogoUrl ?? selectedChannel?.overlay_logo_url ?? "/overlay-logo.png"}
        />
        {!streamConfigured && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {playout
              ? "Set VITE_PLAYOUT_HLS_BASE to enable the stream"
              : "Set VITE_MIST_HLS_BASE to enable the stream"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/schedules" className="text-primary hover:underline">
          Edit today's schedule →
        </Link>
        {now?.next && (
          <span className="text-muted-foreground">
            Next: <span className="text-foreground">{now.next.title}</span>
          </span>
        )}
      </div>

      {!playout && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <ChevronDown className="h-4 w-4" />
              Advanced — Mist debug
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Radio className="h-5 w-5" />
                  Mist push (smoke)
                </CardTitle>
                <CardDescription>
                  {mistConfig?.configured
                    ? "Server env has Mist / playlist-sync configured."
                    : "Set MIST_PLAYLIST_SYNC_URL (+ token) for VPS push; use direct URL smoke otherwise."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => ensureChannel.mutate()} disabled={ensureChannel.isPending}>
                    Ensure channel tv1
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Video for smoke schedule</Label>
                    <Select value={videoId} onValueChange={setVideoId}>
                      <SelectTrigger><SelectValue placeholder="Select video" /></SelectTrigger>
                      <SelectContent>
                        {videos.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={insertGaps} onCheckedChange={setInsertGaps} />
                    Insert {mistConfig?.defaultGapMs ?? 1500}ms black gap between items
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={directSmoke} onCheckedChange={setDirectSmoke} />
                    Direct URL smoke (single item → Mist HTTPS source, no .pls)
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary"
                    onClick={() => smokeSchedule.mutate()}
                    disabled={smokeSchedule.isPending || !channelId || !videoId}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Create smoke schedule
                  </Button>
                  <Button type="button"
                    onClick={() => pushMist.mutate()}
                    disabled={pushMist.isPending || !scheduleId}>
                    <Send className="mr-2 h-4 w-4" />
                    Push to Mist
                  </Button>
                </div>

                {scheduleId && <p className="text-xs text-muted-foreground">Schedule id: {scheduleId}</p>}

                <Textarea readOnly className="min-h-[120px] font-mono text-xs"
                  value={pushResult} placeholder="Push result JSON appears here" />
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      {playout && channels.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-3">
              No channels yet. Create one to start linear playout from the Go engine.
            </p>
            <Button onClick={() => ensureChannel.mutate()} disabled={ensureChannel.isPending}>
              Create default channel (tv1)
            </Button>
          </CardContent>
        </Card>
      )}

      <MonitorPlay className="hidden" />
    </div>
  );
}
