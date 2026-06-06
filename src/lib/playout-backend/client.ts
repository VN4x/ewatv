import { getToken } from "./auth-store";
import { playoutApiBase } from "./config";

const REQUEST_TIMEOUT_MS = 30_000;

export class PlayoutApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PlayoutApiError";
  }
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  auth?: boolean;
};

function assertSafeBaseUrl(base: string): void {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new PlayoutApiError("Invalid playout API URL", 0);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PlayoutApiError("Playout API must use http or https", 0);
  }
}

export async function playoutFetch<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const base = playoutApiBase();
  assertSafeBaseUrl(base);

  if (!path.startsWith("/")) {
    throw new PlayoutApiError("Invalid API path", 0);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      credentials: "same-origin",
    });

    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = (await res.json()) as { error?: string };
        if (err.error) msg = err.error;
      } catch {
        /* ignore */
      }
      throw new PlayoutApiError(msg, res.status);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new PlayoutApiError("Request timed out", 408);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
