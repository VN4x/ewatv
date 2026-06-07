import Hls from "hls.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useViewerSession } from "@/hooks/useViewerSession";

export type LinearPlayerHandle = {
  video: HTMLVideoElement | null;
  reload: () => void;
};

type Props = {
  hlsUrl: string | null;
  channelSlug?: string;
  fallbackYoutubeUrl?: string | null;
  className?: string;
  onError?: (err: string) => void;
  muted?: boolean;
};

export const LinearPlayer = forwardRef<LinearPlayerHandle, Props>(function LinearPlayer(
  { hlsUrl, channelSlug, fallbackYoutubeUrl, className, onError, muted = true },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [errored, setErrored] = useState(false);
  const [loadKey, setLoadKey] = useState(0);

  useViewerSession(channelSlug);

  useImperativeHandle(ref, () => ({
    video: videoRef.current,
    reload: () => {
      setErrored(false);
      setLoadKey((k) => k + 1);
    },
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;
    setErrored(false);

    let stallTimer: number | null = null;
    const armStall = () => {
      if (stallTimer) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        setErrored(true);
        onError?.("Stream stalled (>10s)");
      }, 10_000);
    };
    const clearStall = () => {
      if (stallTimer) window.clearTimeout(stallTimer);
      stallTimer = null;
    };

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setErrored(true);
          onError?.(data.details || "HLS error");
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      void video.play().catch(() => undefined);
    }

    video.addEventListener("waiting", armStall);
    video.addEventListener("playing", clearStall);
    video.addEventListener("stalled", armStall);

    return () => {
      clearStall();
      video.removeEventListener("waiting", armStall);
      video.removeEventListener("playing", clearStall);
      video.removeEventListener("stalled", armStall);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl, loadKey, onError]);

  // YouTube fallback
  if ((errored || !hlsUrl) && fallbackYoutubeUrl) {
    const ytEmbed = toYouTubeEmbed(fallbackYoutubeUrl);
    if (ytEmbed) {
      return (
        <div className={className}>
          <iframe
            src={ytEmbed}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Fallback channel"
          />
        </div>
      );
    }
  }

  return (
    <video
      ref={videoRef}
      className={className}
      playsInline
      muted={muted}
      autoPlay
    />
  );
});

function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    // @handle/videos -> use channel uploads embed via search
    if (u.hostname.includes("youtube.com") && u.pathname.startsWith("/@")) {
      const handle = u.pathname.split("/")[1];
      return `https://www.youtube.com/embed?listType=user_uploads&list=${encodeURIComponent(handle)}&autoplay=1&mute=1&loop=1`;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}`;
    }
    const id = u.searchParams.get("v");
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}`;
    return url;
  } catch {
    return null;
  }
}
