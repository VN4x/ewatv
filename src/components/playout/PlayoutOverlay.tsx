import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NowPlayingResult } from "@/lib/api/playout.functions";

type Props = {
  videoEl: HTMLVideoElement | null;
  now: NowPlayingResult | undefined;
  logoUrl?: string | null;
  className?: string;
};

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function PlayoutOverlay({ videoEl, now, logoUrl, className }: Props) {
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!videoEl) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol = () => setMuted(videoEl.muted);
    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("volumechange", onVol);
    setPlaying(!videoEl.paused);
    setMuted(videoEl.muted);
    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("volumechange", onVol);
    };
  }, [videoEl]);

  useEffect(() => {
    if (!now?.current) return;
    const tick = () => {
      const started = new Date(now.current!.startedAt).getTime();
      setElapsedMs(Date.now() - started);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [now?.current?.startedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!videoEl) return;
      if (e.key === "f") {
        void toggleFullscreen(videoEl);
      } else if (e.key === "m") {
        videoEl.muted = !videoEl.muted;
      } else if (e.key === " ") {
        e.preventDefault();
        if (videoEl.paused) void videoEl.play(); else videoEl.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoEl]);

  const showLogo = logoUrl && !(now?.current?.hideOverlay && !now?.current?.isGap);
  const remainingMs = now?.current ? Math.max(0, now.current.durationMs - elapsedMs) : 0;

  return (
    <div
      className={cn("absolute inset-0", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible((v) => !v)}
    >
      {showLogo && (
        <img
          src={logoUrl}
          alt=""
          className="pointer-events-none absolute left-3 top-3 w-[8%] min-w-[48px] opacity-90"
        />
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 transition-opacity motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto m-3 rounded-xl bg-black/50 p-4 text-white backdrop-blur-md ring-1 ring-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-white/60">Now playing</div>
              <div className="truncate text-base font-semibold">
                {now?.current?.title ?? "Off-air"}
              </div>
              {now?.current?.description && (
                <div className="mt-1 line-clamp-2 text-sm text-white/70">{now.current.description}</div>
              )}
              {now?.current && (
                <div className="mt-1 text-xs text-white/60">
                  {fmt(elapsedMs)} / {fmt(now.current.durationMs)} · {fmt(remainingMs)} remaining
                </div>
              )}
              {now?.next && (
                <div className="mt-2 text-xs text-white/70">
                  Next: <span className="font-medium text-white/90">{now.next.title}</span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!videoEl) return;
                  if (videoEl.paused) void videoEl.play(); else videoEl.pause();
                }}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoEl) videoEl.muted = !videoEl.muted;
                }}
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoEl) void toggleFullscreen(videoEl);
                }}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

async function toggleFullscreen(el: HTMLVideoElement) {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await el.requestFullscreen().catch(() => undefined);
  }
}
