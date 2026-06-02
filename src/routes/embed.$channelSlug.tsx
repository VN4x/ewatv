import { createFileRoute, notFound } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { LinearPlayer, type LinearPlayerHandle } from "@/components/playout/LinearPlayer";
import { PlayoutOverlay } from "@/components/playout/PlayoutOverlay";
import { useNowPlaying } from "@/hooks/useNowPlaying";

export const Route = createFileRoute("/embed/$channelSlug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.channelSlug}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmbedPage,
});

function EmbedPage() {
  const { channelSlug } = Route.useParams();
  const playerRef = useRef<LinearPlayerHandle>(null);
  const [, force] = useState(0);
  const { data: now, isError } = useNowPlaying({ channelSlug });

  if (isError) throw notFound();

  return (
    <div className="fixed inset-0 bg-black">
      <LinearPlayer
        ref={playerRef}
        hlsUrl={now?.hlsUrl ?? null}
        fallbackYoutubeUrl={now?.fallbackYoutubeUrl ?? null}
        className="absolute inset-0 h-full w-full"
        muted
        onError={() => undefined}
      />
      <PlayoutOverlay
        videoEl={playerRef.current?.video ?? null}
        now={now}
        logoUrl={now?.overlayLogoUrl ?? null}
      />
      <MountTrigger onMount={() => force((n) => n + 1)} />
    </div>
  );
}

function MountTrigger({ onMount }: { onMount: () => void }) {
  useState(() => {
    queueMicrotask(onMount);
    return 0;
  });
  return null;
}
