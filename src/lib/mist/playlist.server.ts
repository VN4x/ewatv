import { getMistConfig } from "./config.server";

export type PlsLine =
  | { kind: "path"; path: string; comment?: string }
  | { kind: "gap"; durationMs?: number; comment?: string };

export type ScheduleItemRow = {
  position: number;
  duration_ms: number;
  transition_ms: number;
  source_snapshot: Record<string, unknown>;
  video?: {
    id: string;
    title: string;
    source_type: string;
    source_ref: string;
  } | null;
};

/** Detect gap rows stored in schedule_items.source_snapshot. */
export function isGapItem(snapshot: Record<string, unknown>): boolean {
  return snapshot.kind === "gap" || snapshot.type === "gap";
}

/** Insert 1500ms black gaps between consecutive video items (scheduler helper). */
export function insertGapItems<T extends { kind?: string; type?: string }>(
  items: T[],
  gapMs = 1500,
): Array<T | { kind: "gap"; duration_ms: number }> {
  const out: Array<T | { kind: "gap"; duration_ms: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    out.push(cur);
    const next = items[i + 1];
    const curVideo = cur && typeof cur === "object" && !isGapItem(cur as Record<string, unknown>);
    const nextVideo =
      next && typeof next === "object" && !isGapItem(next as Record<string, unknown>);
    if (curVideo && nextVideo) {
      out.push({ kind: "gap", duration_ms: gapMs });
    }
  }
  return out;
}

/** Map a DB video to VPS media path (file must exist under deploy/mist/media). */
export function videoToMediaPath(videoId: string, filename?: string): string {
  const cfg = getMistConfig();
  const base = cfg.mediaRoot.replace(/\/$/, "");
  if (filename) return `${base}/${filename}`;
  return `${base}/videos/${videoId}.mp4`;
}

export function buildPlsContent(lines: PlsLine[]): string {
  const body = lines
    .map((line) => {
      if (line.kind === "gap") {
        const label = line.comment ?? `gap ${line.durationMs ?? 1500}ms`;
        return `# ${label}\n${getMistConfig().gapAssetPath}`;
      }
      const prefix = line.comment ? `# ${line.comment}\n` : "";
      return `${prefix}${line.path}`;
    })
    .join("\n");
  return `${body}\n\n`;
}

export function scheduleItemsToPlsLines(
  items: ScheduleItemRow[],
  opts?: { insertGaps?: boolean; gapMs?: number },
): PlsLine[] {
  const cfg = getMistConfig();
  const gapMs = opts?.gapMs ?? cfg.defaultGapMs;
  const sorted = [...items].sort((a, b) => a.position - b.position);

  const expanded: ScheduleItemRow[] = [];
  if (opts?.insertGaps) {
    for (let i = 0; i < sorted.length; i++) {
      expanded.push(sorted[i]);
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (
        next &&
        !isGapItem(cur.source_snapshot) &&
        !isGapItem(next.source_snapshot)
      ) {
        expanded.push({
          position: cur.position + 0.5,
          duration_ms: gapMs,
          transition_ms: 0,
          source_snapshot: { kind: "gap", duration_ms: gapMs, show_logo: true },
          video: null,
        });
      }
    }
  } else {
    expanded.push(...sorted);
  }

  return expanded.map((item) => {
    if (isGapItem(item.source_snapshot)) {
      return {
        kind: "gap" as const,
        durationMs: Number(item.source_snapshot.duration_ms ?? gapMs),
        comment: "black gap (logo on in player)",
      };
    }
    const video = item.video;
    if (!video) {
      return {
        kind: "path" as const,
        path: cfg.gapAssetPath,
        comment: "missing video fallback",
      };
    }
    const filename =
      typeof item.source_snapshot.media_filename === "string"
        ? item.source_snapshot.media_filename
        : undefined;
    return {
      kind: "path" as const,
      path: videoToMediaPath(video.id, filename),
      comment: video.title,
    };
  });
}

export async function pushPlsToVps(
  streamName: string,
  pls: string,
): Promise<{ ok: boolean; body: unknown }> {
  const cfg = getMistConfig();
  if (!cfg.playlistSyncUrl) {
    throw new Error(
      "MIST_PLAYLIST_SYNC_URL is not set. Deploy deploy/mist and configure the VPS URL.",
    );
  }
  const url = `${cfg.playlistSyncUrl.replace(/\/$/, "")}/playlists/${streamName}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cfg.playlistSyncToken) {
    headers.authorization = `Bearer ${cfg.playlistSyncToken}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ pls, reload: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `playlist-sync failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`,
    );
  }
  return { ok: true, body };
}
