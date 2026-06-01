import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Folder, FolderPlus, Plus, Search, Trash2, Pencil, ChevronRight, ChevronDown, Play, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Collection = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
};
type Daypart = "any" | "primetime" | "night";
type VideoSource = "mega_s3" | "direct_url" | "youtube" | "vimeo" | "dailymotion";
type Video = {
  id: string;
  collection_id: string | null;
  title: string;
  description: string | null;
  length_sec: number;
  source_type: VideoSource;
  source_ref: string;
  tags: string[];
  category: string | null;
  daypart: Daypart;
  hide_overlay: boolean;
  auto_subs: boolean;
};

export const Route = createFileRoute("/_authenticated/collections")({
  head: () => ({ meta: [{ title: "Collections — ewatv" }] }),
  component: CollectionsPage,
});

function CollectionsPage() {
  const qc = useQueryClient();
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: collections = [] } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Collection[];
    },
  });

  const { data: videos = [], isLoading: videosLoading } = useQuery({
    queryKey: ["videos", selectedCollection, search],
    queryFn: async () => {
      let q = supabase.from("videos").select("*").order("created_at", { ascending: false });
      if (selectedCollection) q = q.eq("collection_id", selectedCollection);
      if (search.trim()) q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as Video[];
    },
  });

  const tree = useMemo(() => buildTree(collections), [collections]);

  const toggle = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Sidebar: folder tree */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Folders</h2>
          <NewFolderDialog parentId={null} onCreated={() => qc.invalidateQueries({ queryKey: ["collections"] })} />
        </div>
        <button
          onClick={() => setSelectedCollection(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            selectedCollection === null ? "bg-secondary" : "hover:bg-secondary/50"
          )}
        >
          <Folder className="h-4 w-4" />
          All videos
        </button>
        <div className="space-y-0.5">
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              selected={selectedCollection}
              onSelect={setSelectedCollection}
              onChanged={() => qc.invalidateQueries({ queryKey: ["collections"] })}
            />
          ))}
        </div>
      </aside>

      {/* Main: video table */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, category…"
              className="pl-8"
            />
          </div>
          <VideoDialog
            collections={collections}
            defaultCollectionId={selectedCollection}
            onSaved={() => qc.invalidateQueries({ queryKey: ["videos"] })}
            trigger={
              <Button>
                <Plus className="mr-1.5 h-4 w-4" />
                Add video
              </Button>
            }
          />
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2 w-20">Length</th>
                <th className="px-3 py-2">Category / Tags</th>
                <th className="px-3 py-2 w-28">Daypart</th>
                <th className="px-3 py-2 w-20 text-center">Logo</th>
                <th className="px-3 py-2 w-20 text-center">Subs</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {videosLoading && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!videosLoading && videos.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No videos yet. Click "Add video".</td></tr>
              )}
              {videos.map((v, i) => (
                <tr key={v.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{v.title}</div>
                    {v.description && (
                      <div className="line-clamp-1 text-xs text-muted-foreground">{v.description}</div>
                    )}
                    <div className="mt-0.5 text-xs text-muted-foreground truncate max-w-md">{v.source_ref}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatLen(v.length_sec)}</td>
                  <td className="px-3 py-2">
                    {v.category && <Badge variant="secondary" className="mr-1">{v.category}</Badge>}
                    {v.tags.map((t) => (
                      <Badge key={t} variant="outline" className="mr-1 text-xs">{t}</Badge>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={v.daypart === "any" ? "outline" : "default"}>{v.daypart}</Badge>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn("text-xs", v.hide_overlay ? "text-muted-foreground" : "text-foreground")}>
                      {v.hide_overlay ? "hidden" : "shown"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn("text-xs", v.auto_subs ? "text-foreground" : "text-muted-foreground")}>
                      {v.auto_subs ? "on" : "off"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <VideoDialog
                        collections={collections}
                        existing={v}
                        onSaved={() => qc.invalidateQueries({ queryKey: ["videos"] })}
                        trigger={
                          <Button size="icon" variant="ghost"><Pencil className="h-4 w-4" /></Button>
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm("Delete this video?")) return;
                          const { error } = await supabase.from("videos").delete().eq("id", v.id);
                          if (error) toast.error(error.message);
                          else {
                            toast.success("Deleted");
                            qc.invalidateQueries({ queryKey: ["videos"] });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ============= Tree =============
type TreeData = Collection & { children: TreeData[] };
function buildTree(items: Collection[]): TreeData[] {
  const map = new Map<string, TreeData>();
  items.forEach((c) => map.set(c.id, { ...c, children: [] }));
  const roots: TreeData[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function TreeNode({
  node, depth, expanded, onToggle, selected, onSelect, onChanged,
}: {
  node: TreeData; depth: number; expanded: Set<string>; onToggle: (id: string) => void;
  selected: string | null; onSelect: (id: string) => void; onChanged: () => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm",
          selected === node.id ? "bg-secondary" : "hover:bg-secondary/50"
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button onClick={() => onToggle(node.id)} className="text-muted-foreground">
          {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="inline-block w-3.5" />}
        </button>
        <button onClick={() => onSelect(node.id)} className="flex flex-1 items-center gap-1.5 truncate text-left">
          <Folder className="h-3.5 w-3.5" />
          <span className="truncate">{node.name}</span>
        </button>
        <div className="hidden gap-0.5 group-hover:flex">
          <NewFolderDialog parentId={node.id} onCreated={onChanged} compact />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={async () => {
              if (!confirm(`Delete folder "${node.name}"? Subfolders will be deleted; videos in it will move to "All".`)) return;
              const { error } = await supabase.from("collections").delete().eq("id", node.id);
              if (error) toast.error(error.message); else onChanged();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {isOpen && node.children.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} selected={selected} onSelect={onSelect} onChanged={onChanged} />
      ))}
    </div>
  );
}

function NewFolderDialog({ parentId, onCreated, compact }: { parentId: string | null; onCreated: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button size="icon" variant="ghost" className="h-6 w-6"><FolderPlus className="h-3.5 w-3.5" /></Button>
        ) : (
          <Button size="icon" variant="ghost"><FolderPlus className="h-4 w-4" /></Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parentId ? "New subfolder" : "New folder"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={async () => {
              const { data: u } = await supabase.auth.getUser();
              if (!u.user) return;
              const { error } = await supabase.from("collections").insert({
                owner_id: u.user.id,
                parent_id: parentId,
                name: name.trim(),
                description: description.trim() || null,
              });
              if (error) toast.error(error.message);
              else {
                toast.success("Folder created");
                setOpen(false);
                setName(""); setDescription("");
                onCreated();
              }
            }}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= Video dialog =============
function VideoDialog({
  collections, existing, defaultCollectionId, onSaved, trigger,
}: {
  collections: Collection[];
  existing?: Video;
  defaultCollectionId?: string | null;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [lengthSec, setLengthSec] = useState(existing?.length_sec ?? 0);
  const [sourceType, setSourceType] = useState<VideoSource>(existing?.source_type ?? "direct_url");
  const [sourceRef, setSourceRef] = useState(existing?.source_ref ?? "");
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [category, setCategory] = useState(existing?.category ?? "");
  const [daypart, setDaypart] = useState<Daypart>(existing?.daypart ?? "any");
  const [hideOverlay, setHideOverlay] = useState(existing?.hide_overlay ?? false);
  const [autoSubs, setAutoSubs] = useState(existing?.auto_subs ?? false);
  const [collectionId, setCollectionId] = useState<string | null>(existing?.collection_id ?? defaultCollectionId ?? null);

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const payload = {
        owner_id: u.user.id,
        collection_id: collectionId,
        title: title.trim(),
        description: description.trim() || null,
        length_sec: Math.max(0, Math.floor(lengthSec)),
        source_type: sourceType,
        source_ref: sourceRef.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        category: category.trim() || null,
        daypart,
        hide_overlay: hideOverlay,
        auto_subs: autoSubs,
      };
      if (existing) {
        const { error } = await supabase.from("videos").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("videos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(existing ? "Updated" : "Added");
      setOpen(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit video" : "Add video"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Source type</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as VideoSource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="direct_url">Direct URL (.mp4/.mkv/…)</SelectItem>
                <SelectItem value="mega_s3">Mega S3</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="vimeo">Vimeo</SelectItem>
                <SelectItem value="dailymotion">Dailymotion</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Length (seconds)</Label>
            <Input type="number" min={0} value={lengthSec} onChange={(e) => setLengthSec(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{sourceType === "mega_s3" ? "S3 key (bucket/key)" : "URL"}</Label>
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder={sourceType === "mega_s3" ? "ewatv/episode-001.mp4" : "https://…"} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="documentary, music…" />
          </div>
          <div className="space-y-1.5">
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="nature, blue, 4k" />
          </div>
          <div className="space-y-1.5">
            <Label>Daypart</Label>
            <Select value={daypart} onValueChange={(v) => setDaypart(v as Daypart)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any time</SelectItem>
                <SelectItem value="primetime">Primetime (18–23)</SelectItem>
                <SelectItem value="night">Night (23–06)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Folder</Label>
            <Select value={collectionId ?? "__none"} onValueChange={(v) => setCollectionId(v === "__none" ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">(none)</SelectItem>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-2">
            <div>
              <Label>Hide channel logo</Label>
              <p className="text-xs text-muted-foreground">Hide overlay during this video</p>
            </div>
            <Switch checked={hideOverlay} onCheckedChange={setHideOverlay} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-2">
            <div>
              <Label>Auto subtitles</Label>
              <p className="text-xs text-muted-foreground">Generate captions on playout</p>
            </div>
            <Switch checked={autoSubs} onCheckedChange={setAutoSubs} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!title.trim() || !sourceRef.trim() || save.isPending}>
            {save.isPending ? "Saving…" : existing ? "Save" : "Add video"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatLen(s: number) {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
