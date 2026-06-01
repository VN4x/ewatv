import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { MonitorPlay, Radio, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createSmokeSchedule,
  getMistPlayoutConfig,
  pushScheduleToMist,
} from "@/lib/api/mist.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/playout")({
  head: () => ({ meta: [{ title: "Playout — ewatv" }] }),
  component: PlayoutPage,
});

type Channel = {
  id: string;
  name: string;
  slug: string;
  mist_stream_name: string | null;
  overlay_logo_url: string | null;
};

type Video = { id: string; title: string };

function PlayoutPage() {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [channelId, setChannelId] = useState<string>("");
  const [videoId, setVideoId] = useState<string>("");
  const [insertGaps, setInsertGaps] = useState(true);
  const [directSmoke, setDirectSmoke] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<string>("");
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);

  const { data: mistConfig } = useQuery({
    queryKey: ["mist-config"],
    queryFn: () => getMistPlayoutConfig(),
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data, error } = await supabase.from("channels").select("*").order("name");
      if (error) throw error;
      return data as Channel[];
    },
  });

  const { data: videos = [] } = useQuery({
    queryKey: ["videos-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title")
        .order("title")
        .limit(50);
      if (error) throw error;
      return data as Video[];
    },
  });

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId),
    [channels, channelId],
  );

  const logoUrl =
    selectedChannel?.overlay_logo_url ??
    import.meta.env.VITE_OVERLAY_LOGO_URL ??
    "/overlay-logo.png";

  useEffect(() => {
    if (!channelId && channels[0]) setChannelId(channels[0].id);
    if (!videoId && videos[0]) setVideoId(videos[0].id);
  }, [channels, videos, channelId, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => undefined);
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      void video.play().catch(() => undefined);
    }
  }, [streamUrl]);

  const ensureChannel = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Not signed in");

      const { data: existing } = await supabase.from("channels").select("id").limit(1);
      if (existing?.[0]) return existing[0].id as string;
      const { data: created, error } = await supabase
        .from("channels")
        .insert({
          name: "TV1",
          slug: "tv1",
          mist_stream_name: "tv1",
          overlay_logo_url: "/overlay-logo.png",
          owner_id: userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return created.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      setChannelId(id);
      toast.success("Default channel ready (tv1)");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create channel"),
  });

  const smokeSchedule = useMutation({
    mutationFn: async () => {
      if (!channelId || !videoId) throw new Error("Select channel and video");
      return createSmokeSchedule({
        data: { channelId, videoId, includeGapAfter: insertGaps },
      });
    },
    onSuccess: (res) => {
      setScheduleId(res.scheduleId);
      toast.success(`Smoke schedule created (${res.itemCount} items)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Schedule failed"),
  });

  const pushMist = useMutation({
    mutationFn: async () => {
      if (!scheduleId) throw new Error("Create a smoke schedule first");
      return pushScheduleToMist({
        data: {
          scheduleId,
          insertGaps,
          allowDirectUrlSmoke: directSmoke,
        },
      });
    },
    onSuccess: (res) => {
      setPushResult(JSON.stringify(res, null, 2));
      if (res.hlsUrl) setStreamUrl(res.hlsUrl);
      toast.success(`Pushed to Mist (${res.mode})`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Push failed"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Playout</h1>
        <p className="text-sm text-muted-foreground">
          Mist smoke test: build a schedule, push <code>.pls</code> to the VPS, play HLS. Black gaps
          use <code>gap-black.mp4</code> on the server; channel logo stays on in the player (
          <code>assets/black.png</code> fallback).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Radio className="h-5 w-5" />
              Mist push (smoke)
            </CardTitle>
            <CardDescription>
              {mistConfig?.configured
                ? "Server env has Mist / playlist-sync configured."
                : "Set MIST_PLAYLIST_SYNC_URL (+ token) on Lovable for VPS push; use direct URL smoke otherwise."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => ensureChannel.mutate()}
                disabled={ensureChannel.isPending}
              >
                Ensure channel tv1
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Video for smoke schedule</Label>
                <Select value={videoId} onValueChange={setVideoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select video" />
                  </SelectTrigger>
                  <SelectContent>
                    {videos.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={insertGaps} onCheckedChange={setInsertGaps} />
                Insert {mistConfig?.defaultGapMs ?? 1500}ms black gap between items (logo on)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={directSmoke} onCheckedChange={setDirectSmoke} />
                Direct URL smoke (single item → Mist HTTPS source, no .pls)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showLogo} onCheckedChange={setShowLogo} />
                Show channel logo overlay in player
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => smokeSchedule.mutate()}
                disabled={smokeSchedule.isPending || !channelId || !videoId}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Create smoke schedule
              </Button>
              <Button
                type="button"
                onClick={() => pushMist.mutate()}
                disabled={pushMist.isPending || !scheduleId}
              >
                <Send className="mr-2 h-4 w-4" />
                Push to Mist
              </Button>
            </div>

            {scheduleId && (
              <p className="text-xs text-muted-foreground">Schedule id: {scheduleId}</p>
            )}

            <Textarea
              readOnly
              className="min-h-[120px] font-mono text-xs"
              value={pushResult}
              placeholder="Push result JSON appears here"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MonitorPlay className="h-5 w-5" />
              Live preview
            </CardTitle>
            <CardDescription>
              {streamUrl ?? mistConfig?.publicHlsBase
                ? `HLS: ${streamUrl ?? `${mistConfig?.publicHlsBase}/tv1/index.m3u8`}`
                : "Set VITE_MIST_HLS_BASE after push"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} className="h-full w-full" playsInline />
              {showLogo && (
                <img
                  src={logoUrl}
                  alt="Channel logo"
                  className={cn(
                    "pointer-events-none absolute left-3 top-3 w-[8%] min-w-[48px] opacity-90",
                  )}
                />
              )}
              {!streamUrl && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Push to Mist to load stream
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
