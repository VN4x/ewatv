import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, ChevronDown, ChevronUp, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  defaultOverlay,
  MAX_OVERLAYS,
  MAX_OVERLAY_PRESETS,
  OVERLAY_ANCHORS,
  type OverlayAnchor,
  type OverlayConfig,
  type OverlayPreset,
} from "@/lib/channels/settings";
import { overlayPositionStyle } from "@/components/playout/PlayoutOverlay";

type Props = {
  channelId: string;
  overlays: OverlayConfig[];
  onChange: (next: OverlayConfig[]) => void;
  presets: OverlayPreset[];
  onPresetsChange: (next: OverlayPreset[]) => void;
};

const ANCHOR_LABELS: Record<OverlayAnchor, string> = {
  tl: "Top-left", tc: "Top-center", tr: "Top-right",
  ml: "Middle-left", mc: "Center", mr: "Middle-right",
  bl: "Bottom-left", bc: "Bottom-center", br: "Bottom-right",
};

const CORNER_PRESETS: { anchor: OverlayAnchor; label: string }[] = [
  { anchor: "tl", label: "Upper-left" },
  { anchor: "tr", label: "Upper-right" },
  { anchor: "bl", label: "Lower-left" },
  { anchor: "br", label: "Lower-right" },
];

export function OverlaysEditor({ channelId, overlays, onChange }: Props) {
  const [activeId, setActiveId] = useState<string | null>(overlays[0]?.id ?? null);

  useEffect(() => {
    if (overlays.length === 0) setActiveId(null);
    else if (!overlays.some((o) => o.id === activeId)) setActiveId(overlays[0].id);
  }, [overlays, activeId]);

  function update(id: string, patch: Partial<OverlayConfig>) {
    onChange(overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }
  function remove(id: string) {
    onChange(overlays.filter((o) => o.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    const i = overlays.findIndex((o) => o.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= overlays.length) return;
    const next = overlays.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add() {
    if (overlays.length >= MAX_OVERLAYS) {
      toast.error(`Max ${MAX_OVERLAYS} overlays`);
      return;
    }
    const o = defaultOverlay({ name: `Overlay ${overlays.length + 1}` });
    onChange([...overlays, o]);
    setActiveId(o.id);
  }

  const active = overlays.find((o) => o.id === activeId) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
      {/* Left: list + add */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Overlays ({overlays.length}/{MAX_OVERLAYS})</Label>
          <Button type="button" size="sm" variant="outline" onClick={add} disabled={overlays.length >= MAX_OVERLAYS}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
        {overlays.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No overlays yet. Click <strong>Add</strong> to create one.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {overlays.map((o, i) => (
              <li
                key={o.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-2 transition-colors cursor-pointer",
                  o.id === activeId ? "border-primary bg-accent/40" : "hover:bg-accent/20",
                )}
                onClick={() => setActiveId(o.id)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-black/80">
                  {o.url ? (
                    <img src={o.url} alt="" className="max-h-full max-w-full" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.name || "Untitled"}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {ANCHOR_LABELS[o.anchor]} · {o.widthPct.toFixed(1)}% · {Math.round(o.opacity * 100)}%
                    {!o.enabled && " · off"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); move(o.id, -1); }} disabled={i === 0}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); move(o.id, 1); }} disabled={i === overlays.length - 1}>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); remove(o.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right: editor + preview */}
      <div className="space-y-4">
        <MiniPreview overlays={overlays} activeId={activeId} />
        {active && (
          <OverlayDetailEditor
            channelId={channelId}
            overlay={active}
            onChange={(patch) => update(active.id, patch)}
          />
        )}
      </div>
    </div>
  );
}

function MiniPreview({ overlays, activeId }: { overlays: OverlayConfig[]; activeId: string | null }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">Preview (16:9)</Label>
      <div
        className="relative mt-1 w-full overflow-hidden rounded-md ring-1 ring-border"
        style={{
          paddingBottom: "56.25%",
          background:
            "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/30">
          Sample frame
        </div>
        {overlays.filter((o) => o.enabled && o.url).map((o) => (
          <img
            key={o.id}
            src={o.url}
            alt=""
            style={overlayPositionStyle(o)}
            className={cn(
              "transition-shadow",
              o.id === activeId && "ring-2 ring-primary ring-offset-1 ring-offset-black",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function OverlayDetailEditor({
  channelId,
  overlay,
  onChange,
}: {
  channelId: string;
  overlay: OverlayConfig;
  onChange: (patch: Partial<OverlayConfig>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${channelId}/${Date.now()}-${overlay.id.slice(0, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("channel-logos")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("channel-logos").getPublicUrl(path);
      onChange({ url: data.publicUrl });
      toast.success("Uploaded — click Save to apply");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function nudge(axis: "x" | "y", delta: number) {
    if (axis === "x") onChange({ offsetXPct: clamp(overlay.offsetXPct + delta, -50, 50) });
    else onChange({ offsetYPct: clamp(overlay.offsetYPct + delta, -50, 50) });
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          value={overlay.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Overlay name"
          className="h-8"
          maxLength={60}
        />
        <div className="flex shrink-0 items-center gap-2">
          <Label className="text-xs text-muted-foreground">Enabled</Label>
          <Switch checked={overlay.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        </div>
      </div>

      {/* URL + upload */}
      <div className="space-y-1.5">
        <Label className="text-xs">Image URL</Label>
        <div className="flex gap-2">
          <Input
            value={overlay.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://…/logo.png"
            className="h-8"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="mr-1 h-4 w-4" />
            {uploading ? "…" : "Upload"}
          </Button>
        </div>
      </div>

      {/* Anchor 3×3 grid */}
      <div className="space-y-1.5">
        <Label className="text-xs">Anchor</Label>
        <div className="inline-grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
          {OVERLAY_ANCHORS.map((a) => (
            <button
              type="button"
              key={a}
              onClick={() => onChange({ anchor: a })}
              title={ANCHOR_LABELS[a]}
              className={cn(
                "h-8 w-8 rounded transition-colors",
                a === overlay.anchor ? "bg-primary" : "bg-background hover:bg-accent",
              )}
            >
              <span className={cn("block h-2 w-2 rounded-full mx-auto", a === overlay.anchor ? "bg-primary-foreground" : "bg-muted-foreground")} />
            </button>
          ))}
        </div>
      </div>

      {/* Offsets with arrows */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">X offset ({overlay.offsetXPct.toFixed(1)}%)</Label>
          <div className="flex items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => nudge("x", -0.5)}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Input
              type="number"
              step={0.5}
              min={-50}
              max={50}
              value={overlay.offsetXPct}
              onChange={(e) => onChange({ offsetXPct: clamp(Number(e.target.value) || 0, -50, 50) })}
              className="h-7 text-xs"
            />
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => nudge("x", 0.5)}>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Y offset ({overlay.offsetYPct.toFixed(1)}%)</Label>
          <div className="flex items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => nudge("y", -0.5)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Input
              type="number"
              step={0.5}
              min={-50}
              max={50}
              value={overlay.offsetYPct}
              onChange={(e) => onChange({ offsetYPct: clamp(Number(e.target.value) || 0, -50, 50) })}
              className="h-7 text-xs"
            />
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => nudge("y", 0.5)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Size + opacity sliders */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Size ({overlay.widthPct.toFixed(1)}% of width)</Label>
          </div>
          <Slider
            value={[overlay.widthPct]}
            min={2}
            max={40}
            step={0.5}
            onValueChange={(v) => onChange({ widthPct: v[0] })}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Opacity ({Math.round(overlay.opacity * 100)}%)</Label>
          </div>
          <Slider
            value={[overlay.opacity * 100]}
            min={10}
            max={100}
            step={1}
            onValueChange={(v) => onChange({ opacity: v[0] / 100 })}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: anchor pins the corner; offset nudges in % of the screen so position scales to any embed size.
      </p>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
