import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { isPlayoutBackend, listChannels } from "@/lib/data";
import { playoutApi } from "@/lib/playout-backend/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — ewatv" }] }),
  component: AnalyticsPage,
});

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtMinutes(ms: number) {
  return Math.round(ms / 60_000).toLocaleString();
}

function AnalyticsPage() {
  const playout = isPlayoutBackend();
  const [channelSlug, setChannelSlug] = useState<string>("__all__");

  const range = useMemo(() => {
    const to = new Date();
    const from = subDays(to, 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: listChannels,
    enabled: playout,
  });

  const channelParam = channelSlug === "__all__" ? undefined : channelSlug;

  const { data: live } = useQuery({
    queryKey: ["analytics-live"],
    queryFn: () => playoutApi.analyticsLive(),
    enabled: playout,
    refetchInterval: 15_000,
  });

  const { data: summary } = useQuery({
    queryKey: ["analytics-summary", channelParam, range.from],
    queryFn: () =>
      playoutApi.analyticsSummary({ channel: channelParam, from: range.from, to: range.to }),
    enabled: playout,
  });

  const { data: byHour } = useQuery({
    queryKey: ["analytics-hour", channelParam, range.from],
    queryFn: () =>
      playoutApi.analyticsByHour({ channel: channelParam, from: range.from, to: range.to }),
    enabled: playout,
  });

  const { data: byDow } = useQuery({
    queryKey: ["analytics-dow", channelParam, range.from],
    queryFn: () =>
      playoutApi.analyticsByDow({ channel: channelParam, from: range.from, to: range.to }),
    enabled: playout,
  });

  const { data: byCountry } = useQuery({
    queryKey: ["analytics-geo", channelParam, range.from],
    queryFn: () =>
      playoutApi.analyticsByCountry({ channel: channelParam, from: range.from, to: range.to }),
    enabled: playout,
  });

  if (!playout) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Viewer analytics requires standalone playout mode (`VITE_DATA_SOURCE=playout`).
        </p>
      </div>
    );
  }

  const hourChart = (byHour?.points ?? []).map((p) => ({
    label: format(new Date(p.hour), "MMM d HH:mm"),
    minutes: Math.round(p.total_watch_ms / 60_000),
    sessions: p.sessions,
  }));

  const dowChart = (byDow?.points ?? []).map((p) => ({
    label: DOW_LABELS[p.day_of_week] ?? String(p.day_of_week),
    minutes: Math.round(p.total_watch_ms / 60_000),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Live viewers and watch time (last 7 days). Sessions tracked from embed and playout pages.
          </p>
        </div>
        <Select value={channelSlug} onValueChange={setChannelSlug}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All channels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All channels</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.slug}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Live now" value={String(live?.total_viewers ?? 0)} />
        <StatCard title="Sessions (7d)" value={String(summary?.unique_sessions ?? 0)} />
        <StatCard title="Watch minutes (7d)" value={fmtMinutes(summary?.total_watch_ms ?? 0)} />
        <StatCard title="Peak / hour (7d)" value={String(summary?.peak_concurrent ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Watch minutes by hour</CardTitle>
            <CardDescription>Rolling 7-day window</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {hourChart.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" hide />
                  <YAxis width={48} />
                  <Tooltip />
                  <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Minutes by day of week</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {dowChart.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dowChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" />
                  <YAxis width={48} />
                  <Tooltip />
                  <Bar dataKey="minutes" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Live by channel</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(live?.channels ?? []).map((c) => (
                <li key={c.channel_id} className="flex justify-between py-2">
                  <span>{c.name}</span>
                  <span className="tabular-nums font-medium">{c.viewers}</span>
                </li>
              ))}
              {(live?.channels ?? []).length === 0 && (
                <li className="py-4 text-muted-foreground">No active sessions</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top regions</CardTitle>
            <CardDescription>By country code (CDN header when available)</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(byCountry?.points ?? []).map((g) => (
                <li key={g.country_code} className="flex justify-between py-2">
                  <span>{g.country_code}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {fmtMinutes(g.total_watch_ms)} min · {g.sessions} sessions
                  </span>
                </li>
              ))}
              {(byCountry?.points ?? []).length === 0 && (
                <li className="py-4 text-muted-foreground">No geo data yet</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No session data yet — open a playout page to generate heartbeats.
    </div>
  );
}
