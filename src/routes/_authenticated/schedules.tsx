import { createFileRoute } from "@tanstack/react-router";
import { Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/schedules")({
  head: () => ({ meta: [{ title: "Schedules — ewatv" }] }),
  component: SchedulesPage,
});

function SchedulesPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Calendar className="mb-3 h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Schedules</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Coming in milestone 3: calendar view, drag-and-drop ordering, frame-accurate timing,
        autopilot generation, and m3u/csv/txt/markdown importers.
      </p>
    </div>
  );
}
