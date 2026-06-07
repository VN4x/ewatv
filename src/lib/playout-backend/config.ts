/** Standalone Go playout backend (no Supabase). */
export function isPlayoutBackend(): boolean {
  return import.meta.env.VITE_DATA_SOURCE === "playout";
}

export function playoutApiBase(): string {
  const base = import.meta.env.VITE_PLAYOUT_API ?? "http://localhost:8090";
  return base.replace(/\/$/, "");
}

export function playoutHlsBase(): string {
  const base = import.meta.env.VITE_PLAYOUT_HLS_BASE ?? playoutApiBase() + "/hls";
  return base.replace(/\/$/, "");
}
