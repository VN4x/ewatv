import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { ArrowLeft, Copy, Trash2, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  parseChannelPlayoutSettings,
  mergePlayoutIntoSettings,
  DEFAULT_CHANNEL_TRANSITION_MS,
  DEFAULT_AUTOPILOT_PUSH_HOUR,
} from "@/lib/channels/settings";
import { runAutopilotNow } from "@/lib/api/autopilot.functions";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/channels/$channelSlug/settings")({
  head: ({ params }) => ({
    meta: [{ title: `${params.channelSlug === "new" ? "New channel" : params.channelSlug} — Settings` }],
  }),
  component: ChannelSettingsPage,
});

const slugRe = /^[a-z0-9-]+$/;
const slugSchema = z.string().trim().min(1).max(64).regex(slugRe, "Lowercase letters, digits, hyphens only");
const nameSchema = z.string().trim().min(1).max(120);
const urlSchema = z.string().trim().url().max(2048);

function toSlug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  overlay_logo_url: string | null;
  fallback_youtube_url: string | null;
  settings: Json | null;
};

function ChannelSettingsPage() {
  const { channelSlug } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = channelSlug === "new";

  const { data: channel, isLoading } = useQuery({
    enabled: !isNew,
    queryKey: ["channel-by-slug", channelSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("id,name,slug,overlay_logo_url,fallback_youtube_url,settings")
        .eq("slug", channelSlug)
        .maybeSingle();
      if (error) throw error;
      return (data as ChannelRow | null) ?? null;
    },
  });

  if (isNew) return <CreateChannelView />;
  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!channel)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Channel not found.</p>
        <Button asChild variant="outline">
          <Link to="/schedules">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to schedules
          </Link>
        </Button>
      </div>
    );

  return <EditChannelView channel={channel} onDeleted={() => navigate({ to: "/schedules" })} qc={qc} />;
}

function CreateChannelView() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);

  const nameRes = nameSchema.safeParse(name);
  const slugRes = slugSchema.safeParse(slug);
  const canSubmit = nameRes.success && slugRes.success;

  const createMut = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { data: dup } = await supabase
        .from("channels")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (dup) throw new Error("Slug already in use");
      const { data, error } = await supabase
        .from("channels")
        .insert({ name, slug, owner_id: uid })
        .select("slug")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      toast.success(`Channel "${name}" created`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      navigate({ to: "/channels/$channelSlug/settings", params: { channelSlug: row.slug } });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create channel"),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New channel</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/schedules">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!touchedSlug) setSlug(toSlug(e.target.value));
              }}
              maxLength={120}
              autoFocus
            />
            {name && !nameRes.success && (
              <p className="text-xs text-destructive">{nameRes.error.issues[0]?.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input
              value={slug}
              maxLength={64}
              onChange={(e) => {
                setTouchedSlug(true);
                setSlug(toSlug(e.target.value));
              }}
            />
            {slug && !slugRes.success && (
              <p className="text-xs text-destructive">{slugRes.error.issues[0]?.message}</p>
            )}
            <p className="text-xs text-muted-foreground">Used in URLs and the embed snippet.</p>
          </div>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!canSubmit || createMut.isPending}
          >
            Create channel
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function EditChannelView({
  channel,
  onDeleted,
  qc,
}: {
  channel: ChannelRow;
  onDeleted: () => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const navigate = useNavigate();
  const playout = useMemo(() => parseChannelPlayoutSettings(channel.settings), [channel.settings]);

  const [name, setName] = useState(channel.name);
  const [slug, setSlug] = useState(channel.slug);
  const [logoUrl, setLogoUrl] = useState(channel.overlay_logo_url ?? "");
  const [fallback, setFallback] = useState(channel.fallback_youtube_url ?? "");
  const [gapSec, setGapSec] = useState<number>(Math.round(playout.transition_ms / 1000));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(channel.name);
    setSlug(channel.slug);
    setLogoUrl(channel.overlay_logo_url ?? "");
    setFallback(channel.fallback_youtube_url ?? "");
    setGapSec(Math.round(playout.transition_ms / 1000));
  }, [channel, playout.transition_ms]);

  const nameRes = nameSchema.safeParse(name);
  const slugRes = slugSchema.safeParse(slug);
  const fallbackRes = fallback ? urlSchema.safeParse(fallback) : { success: true as const };
  const logoRes = logoUrl ? urlSchema.safeParse(logoUrl) : { success: true as const };
  const gapValid = Number.isFinite(gapSec) && gapSec >= 0 && gapSec <= 60;

  const canSave =
    nameRes.success && slugRes.success && fallbackRes.success && logoRes.success && gapValid;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (slug !== channel.slug) {
        const { data: dup } = await supabase
          .from("channels")
          .select("id")
          .eq("slug", slug)
          .neq("id", channel.id)
          .maybeSingle();
        if (dup) throw new Error("Slug already in use by another channel");
      }
      const newSettings = mergePlayoutIntoSettings(channel.settings, {
        transition_ms: Math.max(0, Math.min(60000, Math.round(gapSec * 1000))),
      });
      const { error } = await supabase
        .from("channels")
        .update({
          name,
          slug,
          overlay_logo_url: logoUrl || null,
          fallback_youtube_url: fallback || null,
          settings: newSettings,
        })
        .eq("id", channel.id);
      if (error) throw error;
      return slug;
    },
    onSuccess: (newSlug) => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["channel-by-slug"] });
      if (newSlug !== channel.slug) {
        navigate({ to: "/channels/$channelSlug/settings", params: { channelSlug: newSlug } });
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const { data: scheds, error: e1 } = await supabase
        .from("schedules")
        .select("id")
        .eq("channel_id", channel.id);
      if (e1) throw e1;
      const ids = (scheds ?? []).map((s) => s.id);
      if (ids.length > 0) {
        const { error: e2 } = await supabase.from("schedule_items").delete().in("schedule_id", ids);
        if (e2) throw e2;
        const { error: e3 } = await supabase.from("schedules").delete().in("id", ids);
        if (e3) throw e3;
      }
      const { error } = await supabase.from("channels").delete().eq("id", channel.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Channel deleted");
      qc.invalidateQueries({ queryKey: ["channels"] });
      onDeleted();
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  async function uploadLogo(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${channel.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("channel-logos")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("channel-logos").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.success("Logo uploaded — click Save to apply");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Embed snippet — responsive 16:9, no chrome
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = `${origin}/embed/${slug}`;
  const embedSnippet = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;background:#000">
  <iframe
    src="${embedUrl}"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    allow="autoplay; fullscreen; picture-in-picture"
    allowfullscreen
    loading="lazy"
    title="${name}"
  ></iframe>
</div>`;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{channel.name}</h1>
          <p className="text-sm text-muted-foreground">Channel settings</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/schedules">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to schedules
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Name and slug used everywhere on the channel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            {!nameRes.success && name && (
              <p className="text-xs text-destructive">{nameRes.error.issues[0]?.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(toSlug(e.target.value))} maxLength={64} />
            {!slugRes.success && slug && (
              <p className="text-xs text-destructive">{slugRes.error.issues[0]?.message}</p>
            )}
            {slug !== channel.slug && (
              <p className="text-xs text-muted-foreground">
                Changing the slug breaks existing embed URLs.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Overlay logo</CardTitle>
          <CardDescription>
            Shown over the player at all times. Per-video <em>hide overlay</em> still hides it on
            videos that already have a logo burnt in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-md bg-black/80 ring-1 ring-border">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="max-h-full max-w-full" />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLogo(f);
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
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? "Uploading…" : "Upload PNG / JPG / SVG"}
              </Button>
              <Input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://…/logo.png"
              />
              {!logoRes.success && logoUrl && (
                <p className="text-xs text-destructive">Enter a valid URL</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fallback</CardTitle>
          <CardDescription>
            Shown when the live stream fails. YouTube URL, MP4, or image (PNG / JPG) on the same VPS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label>Fallback URL</Label>
          <Input
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            placeholder="https://www.youtube.com/@channel/videos"
          />
          {!fallbackRes.success && fallback && (
            <p className="text-xs text-destructive">Enter a valid URL</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transition</CardTitle>
          <CardDescription>
            Gap between every video in this channel. During the gap, a “NEXT” card with the
            upcoming title and start time is shown over a dimmed screen with the logo on top.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label>Gap (seconds, 0–60)</Label>
          <Input
            type="number"
            min={0}
            max={60}
            value={gapSec}
            onChange={(e) => setGapSec(Number(e.target.value) || 0)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Default {DEFAULT_CHANNEL_TRANSITION_MS / 1000}s. Set 0 to disable the NEXT card.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embed</CardTitle>
          <CardDescription>
            Paste this snippet on any page. It autoplays (muted by browser policy), is fully
            responsive (16:9), and fills any container — including phone screens. The logo stays
            in the same on-screen position.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Embed URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={embedUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(embedUrl);
                  toast.success("URL copied");
                }}
                title="Copy URL"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>HTML snippet</Label>
            <Textarea readOnly value={embedSnippet} className="font-mono text-xs" rows={9} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(embedSnippet);
                toast.success("Snippet copied");
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy snippet
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Preview</Label>
            <div className="relative overflow-hidden rounded-md bg-black ring-1 ring-border" style={{ paddingBottom: "56.25%" }}>
              <iframe
                key={slug}
                src={embedUrl}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; fullscreen; picture-in-picture"
                title={`${name} preview`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}>
          Save settings
        </Button>
        <Button asChild variant="outline">
          <Link to="/schedules">Cancel</Link>
        </Button>
      </div>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting the channel removes all of its schedules. Videos are kept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete channel
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{channel.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes the channel and all of its schedules. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
