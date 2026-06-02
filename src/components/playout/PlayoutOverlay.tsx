import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NowPlayingResult } from "@/lib/api/playout.functions";
import type { OverlayConfig } from "@/lib/channels/settings";
import { defaultOverlay } from "@/lib/channels/settings";

type Props = {
  videoEl: HTMLVideoElement | null;
  now: NowPlayingResult | undefined;
  /** Preferred: array of configured overlays. */
  overlays?: OverlayConfig[];
  /** Legacy single-logo fallback when overlays not provided/empty. */
  logoUrl?: string | null;
  className?: string;
};

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Compute absolute-position CSS for an overlay relative to the player surface. */
export function overlayPositionStyle(o: OverlayConfig): React.CSSProperties {
  const v = o.anchor[0]; // t/m/b
  const h = o.anchor[1]; // l/c/r
  const style: React.CSSProperties = {
    position: "absolute",
    width: `${o.widthPct}%`,
    height: "auto",
    opacity: o.opacity,
    pointerEvents: "none",
    userSelect: "none",
  };
  // Horizontal
  if (h === "l") style.left = `${o.offsetXPct}%`;
  else if (h === "r") style.right = `${-o.offsetXPct}%`;
  else {
    style.left = `${50 + o.offsetXPct}%`;
    style.transform = (style.transform ?? "") + " translateX(-50%)";
  }
  // Vertical
  if (v === "t") style.top = `${o.offsetYPct}%`;
  else if (v === "b") style.bottom = `${-o.offsetYPct}%`;
  else {
    style.top = `${50 + o.offsetYPct}%`;
    style.transform = (style.transform ?? "") + " translateY(-50%)";
  }
  return style;
}

export function PlayoutOverlay({ videoEl, now, overlays, logoUrl, className }: Props) {
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

  const isGap = !!now?.current?.isGap;
  const hideOverlays = !isGap && !!now?.current?.hideOverlay;

  const resolved: OverlayConfig[] = useMemo(() => {
    if (overlays && overlays.length > 0) return overlays.filter((o) => o.enabled && o.url);
    if (logoUrl) return [defaultOverlay({ url: logoUrl })];
    return [];
  }, [overlays, logoUrl]);

  const remainingMs = now?.current ? Math.max(0, now.current.durationMs - elapsedMs) : 0;
  const next = now?.next;
  const nextEnd = next ? new Date(new Date(next.startsAt).getTime() + next.durationMs).toISOString() : null;

  return (
    <div
      className={cn("absolute inset-0", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible((v) => !v)}
    >
      {!hideOverlays && resolved.map((o) => (
        <img
          key={o.id}
          src={o.url}
          alt=""
          style={overlayPositionStyle(o)}
          className="z-20"
        />
      ))}

      {/* NEXT card during transitions */}
      {isGap && next && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-6 max-w-2xl text-center text-white">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
              Next
            </div>
            <div className="text-3xl font-bold leading-tight sm:text-4xl">{next.title}</div>
            {next.description && (
              <div className="mt-3 line-clamp-2 text-base text-white/80 sm:text-lg">
                {next.description}
              </div>
            )}
            <div className="mt-4 text-sm tabular-nums text-white/70">
              {fmtTime(next.startsAt)}
              {nextEnd && ` – ${fmtTime(nextEnd)}`}
            </div>
          </div>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-30 transition-opacity motion-reduce:transition-none",
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
              {next && (
                <div className="mt-2 text-xs text-white/70">
                  Next: <span className="font-medium text-white/90">{next.title}</span>
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
