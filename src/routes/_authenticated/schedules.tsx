import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import {
  isPlayoutBackend,
  listChannels,
  listCollections,
  listVideos,
  getSchedule,
  saveScheduleToBackend,
  runAutopilotBackend,
  updateChannel,
  updateChannelPlayoutSettings,
  getPrevScheduleEnd,
  createEmptySchedule,
} from "@/lib/data";
import { mergePlayoutIntoSettings } from "@/lib/channels/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GripVertical,
  Plus,
  Save,
  Trash2,
  Calendar as CalendarIcon,
  CalendarPlus,
  Search,
  Bot,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { parseChannelPlayoutSettings } from "@/lib/channels/settings";
import {
  retryPushScheduleToMist,
  saveScheduleAndPush,
  updateChannelPlayout,
} from "@/lib/api/schedule.functions";
import { runAutopilotNow, updateChannelAutopilot } from "@/lib/api/autopilot.functions";

export const Route = createFileRoute("/_authenticated/schedules")({
  head: () => ({ meta: [{ title: "Schedules — ewatv" }] }),
  component: SchedulesPage,
});

type Channel = {
  id: string;
  name: string;
  slug: string;
  settings?: Record<string, unknown> | null;
};
type Video = {
  id: string;
  title: string;
  length_sec: number;
  source_type: string;
  source_ref: string;
  collection_id: string | null;
};
type Item = {
  id: string;
  video_id: string;
  title: string;
  duration_ms: number;
  transition_ms: number;
  source_snapshot: { source_type: string; source_ref: string };
  start_at?: string;
  persisted?: boolean;
};

function fmtDur(ms: number) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function SchedulesPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState<string>("00:00");
  const [startTimeTouched, setStartTimeTouched] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  const [playoutActive, setPlayoutActive] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const playout = isPlayoutBackend();

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const data = await listChannels();
      return data as Channel[];
    },
  });

  useEffect(() => {
    if (!channelId && channels.length > 0) setChannelId(channels[0].id);
  }, [channels, channelId]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channels, channelId],
  );
  const channelSettings = useMemo(
    () => parseChannelPlayoutSettings((selectedChannel?.settings ?? null) as never),
    [selectedChannel],
  );

  useEffect(() => {
    setPlayoutActive(channelSettings.playout_active);
    setAutopilot(channelSettings.autopilot_enabled);
  }, [channelSettings.playout_active, channelSettings.autopilot_enabled, channelId]);

  const { data: loaded, isFetching: loadingSched } = useQuery({
    enabled: !!channelId && !!date,
    queryKey: ["schedule", channelId, date],
    queryFn: async () => {
      if (playout && channelId) {
        const view = await getSchedule(channelId, date);
        if (!view?.schedule) return { schedule: null, items: [] as Item[] };
        const mapped: Item[] = (view.items ?? []).map((r) => ({
          id: r.id,
          video_id: r.video_id ?? "",
          title: (r.source_snapshot?.title as string) ?? "(video)",
          duration_ms: r.duration_ms,
          transition_ms: r.transition_ms,
          source_snapshot: r.source_snapshot as Item["source_snapshot"],
          persisted: true,
        }));
        return { schedule: view.schedule, items: mapped };
      }
      const { data: sched, error } = await supabase
        .from("schedules")
        .select("id,autopilot")
        .eq("channel_id", channelId!)
        .eq("schedule_date", date)
        .maybeSingle();
      if (error) throw error;
      if (!sched) return { schedule: null, items: [] as Item[] };
      const { data: rows, error: e2 } = await supabase
        .from("schedule_items")
        .select(
          "id,video_id,duration_ms,transition_ms,source_snapshot,start_at,position,videos(title)",
        )
        .eq("schedule_id", sched.id)
        .order("position");
      if (e2) throw e2;
      const mapped: Item[] = (rows ?? []).map((r: any) => ({
        id: r.id,
        video_id: r.video_id,
        title: r.videos?.title ?? "(deleted video)",
        duration_ms: r.duration_ms,
        transition_ms: r.transition_ms,
        source_snapshot: r.source_snapshot ?? { source_type: "", source_ref: "" },
        persisted: true,
      }));
      return { schedule: sched, items: mapped };
    },
  });

  useEffect(() => {
    if (loaded) setItems(loaded.items);
  }, [loaded]);

  // Recompute start_at locally — every item uses the channel-wide transition_ms.
  const channelGap = channelSettings.transition_ms;
  const computed = useMemo(() => {
    const base = new Date(`${date}T${startTime || "00:00"}:00`);
    let t = base.getTime();
    return items.map((it) => {
      const start = new Date(t).toISOString();
      t += it.duration_ms + channelGap;
      return { ...it, transition_ms: channelGap, start_at: start };
    });
  }, [items, date, startTime, channelGap]);

  const totalMs = computed.reduce((a, it) => a + it.duration_ms + it.transition_ms, 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((arr) => {
      const oldIdx = arr.findIndex((x) => x.id === active.id);
      const newIdx = arr.findIndex((x) => x.id === over.id);
      return arrayMove(arr, oldIdx, newIdx);
    });
  }

  const { data: prevEnd } = useQuery({
    enabled: !!channelId,
    queryKey: ["prev-end", channelId, loaded?.schedule?.id ?? null, playout ? "go" : "sb"],
    queryFn: () => getPrevScheduleEnd(channelId!, loaded?.schedule?.id),
  });

  // Auto-prefill date + start time from previous schedule's end (unless user touched it).
  useEffect(() => {
    if (!prevEnd || startTimeTouched) return;
    if (loaded?.items.length) return;
    const d = new Date(prevEnd);
    setDate(format(d, "yyyy-MM-dd"));
    setStartTime(format(d, "HH:mm"));
  }, [prevEnd, loaded, startTimeTouched]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!channelId) throw new Error("Pick a channel");
      const itemsPayload = computed.map((it) => ({
        video_id: it.video_id,
        duration_ms: it.duration_ms,
        transition_ms: it.transition_ms,
        start_at: it.start_at!,
        source_snapshot: it.source_snapshot,
      }));
      if (playout) {
        return saveScheduleToBackend(channelId, date, {
          autopilot: channelSettings.autopilot_enabled,
          existing_schedule_id: loaded?.schedule?.id,
          items: itemsPayload,
          recompute_start_at: false,
        });
      }
      return saveScheduleAndPush({
        data: {
          channelId,
          scheduleDate: date,
          autopilot: channelSettings.autopilot_enabled,
          existingScheduleId: loaded?.schedule?.id,
          items: computed.map((it) => ({
            video_id: it.video_id,
            duration_ms: it.duration_ms,
            transition_ms: it.transition_ms,
            start_at: it.start_at!,
            source_snapshot: it.source_snapshot,
          })),
          insertGapsOnPush: true,
        },
      });
    },
    onSuccess: (result) => {
      if (playout) {
        toast.success("Schedule saved to playout engine");
      } else if (result.pushed) {
        toast.success("Schedule saved and pushed to Mist");
      } else if (result.pushError) {
        toast.error(`Saved, but Mist push failed: ${result.pushError}`);
      } else {
        toast.success(
          result.pushSkippedReason
            ? `Schedule saved (${result.pushSkippedReason})`
            : "Schedule saved",
        );
      }
      qc.invalidateQueries({ queryKey: ["schedule", channelId, date] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const playoutToggleMut = useMutation({
    mutationFn: async (active: boolean) => {
      if (!channelId) throw new Error("Pick a channel");
      if (playout) {
        const settings = mergePlayoutIntoSettings(selectedChannel?.settings ?? null, {
          playout_active: active,
        });
        return updateChannel(channelId, { playout_active: active, settings });
      }
      return updateChannelPlayout({ data: { channelId, playoutActive: active } });
    },
    onSuccess: (_res, active) => {
      setPlayoutActive(active);
      toast.success(
        playout
          ? active
            ? "Playout active — HLS live from Go engine"
            : "Playout paused"
          : active
            ? "Playout active — saves for today push to Mist"
            : "Playout paused",
      );
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const autopilotMut = useMutation({
    mutationFn: async () => {
      if (!channelId) throw new Error("Pick a channel");
      if (playout) return runAutopilotBackend(channelId, { days: 7, from_date: date });
      return runAutopilotNow({ data: { channelId } });
    },
    onSuccess: (res) => {
      const n = playout
        ? (res as { generated?: unknown[] }).generated?.length ?? 0
        : (res as { generated?: unknown[] }).generated?.length ?? 0;
      toast.success(`Weekly refresh: ${n} day(s) generated`);
      qc.invalidateQueries({ queryKey: ["schedule", channelId, date] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Autopilot failed"),
  });

  const autopilotToggleMut = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!channelId) throw new Error("Pick a channel");
      if (playout) {
        return updateChannelPlayoutSettings(
          channelId,
          selectedChannel?.settings ?? null,
          { autopilot_enabled: enabled },
        );
      }
      return updateChannelAutopilot({
        data: { channelId, autopilotEnabled: enabled },
      });
    },
    onSuccess: (_res, enabled) => {
      setAutopilot(enabled);
      toast.success(enabled ? "Autopilot enabled" : "Autopilot disabled");
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const retryPushMut = useMutation({
    mutationFn: async (scheduleId: string) =>
      retryPushScheduleToMist({ data: { scheduleId, insertGaps: true } }),
    onSuccess: () => {
      toast.success("Pushed to Mist");
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Push failed"),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!channelId) throw new Error("Pick a channel");
      let useDate = date;
      let useStart = startTime;
      if (prevEnd) {
        const d = new Date(prevEnd);
        useDate = format(d, "yyyy-MM-dd");
        useStart = format(d, "HH:mm");
        setDate(useDate);
        setStartTime(useStart);
        setStartTimeTouched(false);
      }
      const { id, alreadyExisted } = await createEmptySchedule(channelId, useDate);
      return { id, alreadyExisted };
    },
    onSuccess: ({ alreadyExisted }) => {
      if (alreadyExisted) {
        toast.message("A schedule already exists for this date — loaded it");
      } else {
        toast.success("Schedule created — add videos to fill up to 24h");
      }
      qc.invalidateQueries({ queryKey: ["schedule", channelId, date] });
      qc.invalidateQueries({ queryKey: ["prev-end", channelId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  function addVideos(videos: Video[]) {
    setItems((arr) => [
      ...arr,
      ...videos.map((v) => ({
        id: `local-${crypto.randomUUID()}`,
        video_id: v.id,
        title: v.title,
        duration_ms: Math.max(1, v.length_sec) * 1000,
        transition_ms: channelGap,
        source_snapshot: { source_type: v.source_type, source_ref: v.source_ref },
      })),
    ]);
    setPickerOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Channel</Label>
          <div className="flex gap-2">
            <Select value={channelId ?? ""} onValueChange={setChannelId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedChannel ? (
              <Button asChild variant="outline" size="icon" title="Channel settings">
                <Link
                  to="/channels/$channelSlug/settings"
                  params={{ channelSlug: selectedChannel.slug }}
                >
                  <SettingsIcon />
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="icon" title="Create channel">
                <Link to="/channels/new/settings">
                  <Plus />
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <Label className="text-xs">Day start</Label>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              setStartTimeTouched(true);
            }}
            className="w-[120px]"
          />
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Switch
            checked={playoutActive}
            onCheckedChange={(v) => playoutToggleMut.mutate(v)}
            disabled={!channelId || playoutToggleMut.isPending}
            id="playout-active"
          />
          <Label htmlFor="playout-active" className="text-sm">
            Playout active
          </Label>
        </div>
        <div className="flex flex-col gap-1 pb-1">
          <div className="flex items-center gap-2">
            <Switch
              checked={autopilot}
              onCheckedChange={(v) => autopilotToggleMut.mutate(v)}
              disabled={!channelId || autopilotToggleMut.isPending}
              id="autopilot"
            />
            <Label htmlFor="autopilot" className="text-sm">
              Autopilot weekly ({channelSettings.autopilot_week_days} days)
            </Label>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            Stays on until you turn off. Fills empty days for the rolling week
            (today + 6).{" "}
            {playout ? (
              <strong>Today&apos;s</strong>
            ) : (
              <>
                <strong>Today&apos;s</strong> lineup is pushed to Mist when Playout active; each
                other day goes live on its calendar date.
              </>
            )}{" "}
            {playout && "The Go engine serves today automatically — no nightly push."}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {prevEnd && (
            <Badge variant="outline" className="tabular-nums">
              Prev ends {format(parseISO(prevEnd), "MMM d HH:mm")}
            </Badge>
          )}
          <Badge variant="outline" className="tabular-nums">
            Gap {Math.round(channelGap / 1000)}s
          </Badge>
          <Badge variant="secondary">
            {computed.length} items · {fmtDur(totalMs)}
          </Badge>
          <Button
            variant="outline"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !channelId}
            title="Create a new schedule starting at the previous schedule's end"
          >
            <CalendarPlus className="mr-2 h-4 w-4" />
            Create
          </Button>
          {loaded?.schedule?.id && playoutActive && !playout && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retryPushMut.isPending}
              onClick={() => retryPushMut.mutate(loaded.schedule!.id)}
            >
              Retry Mist push
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={autopilotMut.isPending || !channelId}
            onClick={() => autopilotMut.mutate()}
            title="Regenerate empty days in the 7-day horizon for this channel"
          >
            <Bot className="mr-2 h-4 w-4" />
            Run autopilot
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !channelId}>
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
        </div>
      </div>

      {!playout && channelSettings.last_mist_push_at && (
        <p className="text-xs text-muted-foreground">
          Last Mist push: {format(parseISO(channelSettings.last_mist_push_at), "MMM d HH:mm")}
          {channelSettings.last_mist_push_error && (
            <span className="text-destructive"> — {channelSettings.last_mist_push_error}</span>
          )}
        </p>
      )}

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b p-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarIcon className="h-4 w-4" />
            {loadingSched ? "Loading…" : `${computed.length} scheduled items`}
          </div>
          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" /> Add videos
              </Button>
            </DialogTrigger>
            <VideoPickerDialog onAdd={addVideos} playout={playout} />
          </Dialog>
        </div>

        {computed.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No items yet. Click <span className="font-medium">Add videos</span> to begin.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={computed.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="divide-y">
                {computed.map((it, idx) => (
                  <SortableRow
                    key={it.id}
                    item={it}
                    index={idx}
                    onRemove={() => setItems((a) => a.filter((x) => x.id !== it.id))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function SortableRow({
  item,
  index,
  onRemove,
}: {
  item: Item;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const startLabel = item.start_at ? format(parseISO(item.start_at), "HH:mm:ss") : "--:--:--";
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center gap-3 p-3", isDragging && "bg-accent/40")}
    >
      <button
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="Drag"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-10 text-right tabular-nums text-xs text-muted-foreground">
        {index + 1}
      </span>
      <span className="w-20 tabular-nums text-sm font-medium">{startLabel}</span>
      <span className="flex-1 truncate text-sm">{item.title}</span>
      <Badge variant="outline" className="tabular-nums">
        {fmtDur(item.duration_ms)}
      </Badge>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove">
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function VideoPickerDialog({
  onAdd,
  playout,
}: {
  onAdd: (v: Video[]) => void;
  playout: boolean;
}) {
  const [search, setSearch] = useState("");
  const [collectionId, setCollectionId] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { data: collections = [] } = useQuery({
    queryKey: ["collections-picker", playout ? "go" : "sb"],
    queryFn: async () => {
      const data = await listCollections();
      return data.map((c) => ({ id: c.id, name: c.name }));
    },
  });
  const { data: videos = [] } = useQuery({
    queryKey: ["videos-picker", collectionId, search, playout ? "go" : "sb"],
    queryFn: async () => {
      const data = await listVideos({
        collectionId: collectionId || null,
        search: search.trim() || undefined,
      });
      return data
        .map((v) => ({
          id: v.id,
          title: v.title,
          length_sec: v.length_sec,
          source_type: v.source_type,
          source_ref: v.source_ref,
          collection_id: v.collection_id,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)) as Video[];
    },
  });

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const pickedList = videos.filter((v) => picked.has(v.id));

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Add videos to schedule</DialogTitle>
      </DialogHeader>
      <div className="flex gap-2">
        <Select
          value={collectionId}
          onValueChange={(v) => setCollectionId(v === "__all" ? "" : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All collections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All collections</SelectItem>
            {collections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title…"
            className="pl-8"
          />
        </div>
      </div>
      <div className="max-h-[400px] overflow-auto rounded-md border">
        {videos.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No videos found
          </div>
        ) : (
          <ul className="divide-y">
            {videos.map((v) => (
              <li
                key={v.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 p-2 hover:bg-accent",
                  picked.has(v.id) && "bg-accent",
                )}
                onClick={() => toggle(v.id)}
              >
                <input type="checkbox" readOnly checked={picked.has(v.id)} />
                <span className="flex-1 truncate text-sm">{v.title}</span>
                <Badge variant="outline" className="tabular-nums text-xs">
                  {fmtDur(v.length_sec * 1000)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter>
        <span className="mr-auto text-xs text-muted-foreground">
          {picked.size} selected
        </span>
        <Button disabled={picked.size === 0} onClick={() => onAdd(pickedList)}>
          Add {picked.size}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
