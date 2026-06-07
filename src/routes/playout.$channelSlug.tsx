import { createFileRoute, notFound } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { LinearPlayer, type LinearPlayerHandle } from "@/components/playout/LinearPlayer";
import { PlayoutOverlay } from "@/components/playout/PlayoutOverlay";
import { useNowPlaying } from "@/hooks/useNowPlaying";

export const Route = createFileRoute("/playout/$channelSlug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.channelSlug} — ewatv` },
      { name: "description", content: `Live playout for ${params.channelSlug}` },
    ],
  }),
  component: PublicPlayoutPage,
});

function PublicPlayoutPage() {
  const { channelSlug } = Route.useParams();
  const playerRef = useRef<LinearPlayerHandle>(null);
  const [, force] = useState(0);
  const { data: now, isError } = useNowPlaying({ channelSlug });

  if (isError) throw notFound();

  return (
    <div className="min-h-screen bg-black">
      <div className="relative mx-auto aspect-video w-full max-w-[1920px] bg-black">
        <LinearPlayer
          ref={playerRef}
          hlsUrl={now?.hlsUrl ?? null}
          channelSlug={channelSlug}
          fallbackYoutubeUrl={now?.fallbackYoutubeUrl ?? null}
          className="absolute inset-0 h-full w-full"
          onError={(e) => toast.error(e)}
        />
        <PlayoutOverlay
          videoEl={playerRef.current?.video ?? null}
          now={now}
          overlays={now?.overlays}
          logoUrl={now?.overlayLogoUrl ?? "/overlay-logo.png"}
        />
        {/* trigger overlay re-render once video el mounts */}
        <RefreshOnMount onMount={() => force((n) => n + 1)} />
      </div>
    </div>
  );
}

function RefreshOnMount({ onMount }: { onMount: () => void }) {
  useState(() => {
    queueMicrotask(onMount);
    return 0;
  });
  return null;
}
