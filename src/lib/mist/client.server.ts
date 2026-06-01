import crypto from "node:crypto";

import { getMistConfig } from "./config.server";

function md5hex(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

type MistJson = Record<string, unknown>;

async function mistRawCall(command: MistJson): Promise<MistJson> {
  const cfg = getMistConfig();
  const base = cfg.apiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api2`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ command: JSON.stringify(command) }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as MistJson;
  } catch {
    throw new Error(`Mist API returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
}

async function authorizeBlock(): Promise<MistJson> {
  const cfg = getMistConfig();
  const chall = await mistRawCall({
    authorize: { username: cfg.apiUser, password: "" },
  });
  const auth = chall.authorize as { status?: string; challenge?: string } | undefined;
  if (auth?.status === "OK") {
    return { authorize: { username: cfg.apiUser, password: "" } };
  }
  if (!auth?.challenge) {
    throw new Error(`Mist auth failed: ${JSON.stringify(auth)}`);
  }
  const passHash = md5hex(md5hex(cfg.apiPassword) + auth.challenge);
  return { authorize: { username: cfg.apiUser, password: passHash } };
}

/** Call Mist API with challenge auth. */
export async function mistCall(command: MistJson): Promise<MistJson> {
  const auth = await authorizeBlock();
  return mistRawCall({ ...auth, ...command });
}

/** Push a single HTTPS/HTTP MP4 source (smoke test without .pls). */
export async function mistAddDirectSource(
  streamName: string,
  sourceUrl: string,
): Promise<MistJson> {
  const safeName = streamName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return mistCall({
    addstream: {
      [safeName]: {
        source: sourceUrl,
        always_on: true,
      },
    },
  });
}

export function publicHlsUrl(streamName: string): string | null {
  const base = getMistConfig().publicHlsBase;
  if (!base) return null;
  const safeName = streamName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${base.replace(/\/$/, "")}/${safeName}/index.m3u8`;
}
