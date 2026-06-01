import { createFileRoute } from "@tanstack/react-router";
import { MonitorPlay } from "lucide-react";

export const Route = createFileRoute("/_authenticated/playout")({
  head: () => ({ meta: [{ title: "Playout — ewatv" }] }),
  component: PlayoutPage,
});

function PlayoutPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <MonitorPlay className="mb-3 h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Playout</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Coming in milestone 2: live HLS player consuming the MistServer stream with title/description
        overlay, total/remaining time, next-on-hover, and channel logo.
      </p>
    </div>
  );
}
