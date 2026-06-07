import { useEffect, useRef } from "react";
import { isPlayoutBackend, playoutApiBase } from "@/lib/playout-backend/config";

const HEARTBEAT_MS = 30_000;

function sessionStorageKey(slug: string) {
  return `ewatv_session_${slug}`;
}

/** Track viewer session heartbeats to Go analytics (playout mode only). */
export function useViewerSession(channelSlug: string | undefined) {
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!channelSlug || !isPlayoutBackend()) return;

    let sessionId = sessionStorage.getItem(sessionStorageKey(channelSlug));
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(sessionStorageKey(channelSlug), sessionId);
    }
    sessionIdRef.current = sessionId;

    const base = playoutApiBase();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => undefined);

    void post("/v1/events/session-start", {
      session_id: sessionId,
      channel_slug: channelSlug,
    });

    const interval = window.setInterval(() => {
      void post("/v1/events/heartbeat", {
        session_id: sessionId,
        watch_ms: HEARTBEAT_MS,
      });
    }, HEARTBEAT_MS);

    const onEnd = () => {
      void post("/v1/events/session-end", {
        session_id: sessionId,
        watch_ms: HEARTBEAT_MS,
      });
      sessionStorage.removeItem(sessionStorageKey(channelSlug));
    };

    window.addEventListener("pagehide", onEnd);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onEnd);
      onEnd();
    };
  }, [channelSlug]);
}
