import process from "node:process";

export type MistServerConfig = {
  apiUrl: string;
  apiUser: string;
  apiPassword: string;
  playlistSyncUrl: string | null;
  playlistSyncToken: string | null;
  /** Path prefix written into .pls files (VPS mount). */
  mediaRoot: string;
  gapAssetPath: string;
  defaultGapMs: number;
  /** Public HLS base for clients, e.g. https://tv.example.com/hls */
  publicHlsBase: string | null;
};

export function getMistConfig(): MistServerConfig {
  return {
    apiUrl: process.env.MIST_API_URL ?? "http://127.0.0.1:4242",
    apiUser: process.env.MIST_API_USER ?? "admin",
    apiPassword: process.env.MIST_API_PASSWORD ?? "",
    playlistSyncUrl: process.env.MIST_PLAYLIST_SYNC_URL ?? null,
    playlistSyncToken: process.env.MIST_PLAYLIST_SYNC_TOKEN ?? null,
    mediaRoot: process.env.MIST_MEDIA_ROOT ?? "/media",
    gapAssetPath: process.env.MIST_GAP_ASSET_PATH ?? "/media/gap-black.mp4",
    defaultGapMs: Number(process.env.MIST_DEFAULT_GAP_MS ?? "1500"),
    publicHlsBase: process.env.VITE_MIST_HLS_BASE ?? process.env.MIST_HLS_BASE ?? null,
  };
}

export function isMistConfigured(): boolean {
  const cfg = getMistConfig();
  return Boolean(cfg.playlistSyncUrl || cfg.apiPassword);
}
