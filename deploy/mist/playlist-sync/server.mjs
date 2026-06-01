/**
 * VPS-side helper: accept playlist text from ewatv server functions,
 * write streamname.pls, and call Mist addstream.
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8787);
const PLAYLIST_DIR = process.env.PLAYLIST_DIR ?? "/playlists";
const MIST_API_URL = (process.env.MIST_API_URL ?? "http://mist:4242").replace(/\/$/, "");
const MIST_USER = process.env.MIST_API_USER ?? "admin";
const MIST_PASS = process.env.MIST_API_PASSWORD ?? "";
const SYNC_TOKEN = process.env.PLAYLIST_SYNC_TOKEN ?? "";

function md5hex(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

async function mistAuthorize() {
  const challRes = await fetch(`${MIST_API_URL}/api2`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      command: JSON.stringify({
        authorize: { username: MIST_USER, password: "" },
      }),
    }),
  });
  const challJson = await challRes.json();
  const challenge = challJson?.authorize?.challenge;
  if (!challenge) {
    if (challJson?.authorize?.status === "OK") {
      return {};
    }
    throw new Error(`Mist auth challenge failed: ${JSON.stringify(challJson?.authorize)}`);
  }
  const passHash = md5hex(md5hex(MIST_PASS) + challenge);
  return {
    authorize: { username: MIST_USER, password: passHash },
  };
}

async function mistCall(extra) {
  const auth = await mistAuthorize();
  const command = { ...auth, ...extra };
  const res = await fetch(`${MIST_API_URL}/api2`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ command: JSON.stringify(command) }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Mist API non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

function checkAuth(req) {
  if (!SYNC_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const alt = req.headers["x-playlist-sync-token"] ?? "";
  return bearer === SYNC_TOKEN || alt === SYNC_TOKEN;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.url === "/health" && req.method === "GET") {
      return send(200, { ok: true });
    }

    if (!checkAuth(req)) {
      return send(401, { ok: false, error: "Unauthorized" });
    }

    const match = req.url?.match(/^\/playlists\/([a-z0-9._-]+)$/i);
    if (!match || req.method !== "POST") {
      return send(404, { ok: false, error: "Not found" });
    }

    const streamName = match[1].toLowerCase();
    const payload = await readBody(req);
    const pls = String(payload.pls ?? "");
    if (!pls.trim()) {
      return send(400, { ok: false, error: "Missing pls body" });
    }

    await fs.mkdir(PLAYLIST_DIR, { recursive: true });
    const plsPath = path.join(PLAYLIST_DIR, `${streamName}.pls`);
    await fs.writeFile(plsPath, pls.endsWith("\n") ? pls : `${pls}\n`, "utf8");

    const mistSource = `/playlists/${streamName}.pls`;
    const mistResponse = await mistCall({
      addstream: {
        [streamName]: {
          source: mistSource,
          always_on: true,
        },
      },
    });

    return send(200, {
      ok: true,
      streamName,
      plsPath,
      mistSource,
      mistResponse,
    });
  } catch (err) {
    console.error(err);
    return send(500, {
      ok: false,
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`playlist-sync listening on :${PORT}`);
});
