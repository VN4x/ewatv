import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Settings as SettingsIcon, Tv } from "lucide-react";

import { listChannels } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Channels" }] }),
  component: SettingsIndexPage,
});

type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  overlay_logo_url: string | null;
};

function SettingsIndexPage() {
  const { data: channels, isLoading } = useQuery({
    queryKey: ["settings-channels-list"],
    queryFn: async () => {
      const data = await listChannels();
      return data.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        overlay_logo_url: c.overlay_logo_url ?? null,
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage channels, embeds, logos, fallbacks and playlist updates.
          </p>
        </div>
        <Button asChild>
          <Link to="/channels/$channelSlug/settings" params={{ channelSlug: "new" }}>
            <Plus className="mr-2 h-4 w-4" />
            Create channel
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>Select a channel to edit its settings.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !channels || channels.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">No channels yet.</p>
              <Button asChild className="mt-3" size="sm">
                <Link to="/channels/$channelSlug/settings" params={{ channelSlug: "new" }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first channel
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {channels.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/channels/$channelSlug/settings"
                    params={{ channelSlug: c.slug }}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-accent/40 px-2 rounded-md transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {c.overlay_logo_url ? (
                        <img
                          src={c.overlay_logo_url}
                          alt=""
                          className="h-8 w-8 rounded object-contain bg-muted"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                          <Tv className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">/{c.slug}</div>
                      </div>
                    </div>
                    <SettingsIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
