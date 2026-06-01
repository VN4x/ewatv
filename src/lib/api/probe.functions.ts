import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  sourceType: z.enum(["direct_url", "mega_s3", "youtube", "vimeo", "dailymotion"]),
  sourceRef: z.string().min(1).max(2000),
});

export const probeVideoDuration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const { sourceType, sourceRef } = data;
    const ref = sourceRef.trim();

    if (sourceType === "youtube") {
      const id = extractYouTubeId(ref);
      if (!id) throw new Error("Could not parse YouTube ID");
      const sec = await probeYouTube(id);
      return { length_sec: sec, title: null as string | null };
    }
    if (sourceType === "vimeo") {
      const r = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(ref)}`,
      );
      if (!r.ok) throw new Error(`Vimeo oEmbed ${r.status}`);
      const j = (await r.json()) as { duration?: number; title?: string };
      if (!j.duration) throw new Error("No duration from Vimeo");
      return { length_sec: Math.round(j.duration), title: j.title ?? null };
    }
    if (sourceType === "dailymotion") {
      const m = ref.match(/(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([a-zA-Z0-9]+)/);
      if (!m) throw new Error("Could not parse Dailymotion ID");
      const r = await fetch(
        `https://api.dailymotion.com/video/${m[1]}?fields=duration,title`,
      );
      if (!r.ok) throw new Error(`Dailymotion ${r.status}`);
      const j = (await r.json()) as { duration?: number; title?: string };
      if (!j.duration) throw new Error("No duration from Dailymotion");
      return { length_sec: Math.round(j.duration), title: j.title ?? null };
    }
    // direct_url / mega_s3: try HEAD then fall back — server can't ffprobe.
    // Caller should use client-side <video> probe for these.
    throw new Error("Use client-side probe for direct/Mega URLs");
  });

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(url)) return url;
  return null;
}

async function probeYouTube(id: string): Promise<number> {
  // Scrape the watch page for "lengthSeconds":"NNN" — no API key needed.
  const r = await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  const html = await r.text();
  const m = html.match(/"lengthSeconds":"(\d+)"/);
  if (!m) throw new Error("Could not find lengthSeconds in YouTube page");
  const sec = Number(m[1]);
  if (!sec || !Number.isFinite(sec)) throw new Error("Invalid duration");
  return sec;
}
