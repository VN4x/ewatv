import { afterEach, describe, expect, it, vi } from "vitest";
import { playoutFetch, PlayoutApiError } from "./client";

describe("playoutFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-http base URLs", async () => {
    vi.stubEnv("VITE_PLAYOUT_API", "file:///etc/passwd");
    await expect(playoutFetch("/v1/channels")).rejects.toMatchObject({
      name: "PlayoutApiError",
      message: "Playout API must use http or https",
    });
  });

  it("throws PlayoutApiError on HTTP error responses", async () => {
    vi.stubEnv("VITE_PLAYOUT_API", "http://localhost:8090");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "invalid token" }),
      }),
    );

    await expect(playoutFetch("/v1/auth/me", { auth: false })).rejects.toEqual(
      new PlayoutApiError("invalid token", 401),
    );
  });

  it("returns parsed JSON on success", async () => {
    vi.stubEnv("VITE_PLAYOUT_API", "http://localhost:8090");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      }),
    );

    const data = await playoutFetch<{ items: unknown[] }>("/v1/collections", { auth: false });
    expect(data.items).toEqual([]);
  });
});
