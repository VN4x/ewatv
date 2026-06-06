import { describe, expect, it } from "vitest";
import {
  mergePlayoutIntoSettings,
  parseChannelPlayoutSettings,
  defaultOverlay,
} from "./settings";

describe("parseChannelPlayoutSettings", () => {
  it("applies defaults for null settings", () => {
    const s = parseChannelPlayoutSettings(null);
    expect(s.playout_active).toBe(false);
    expect(s.autopilot_enabled).toBe(false);
    expect(s.transition_ms).toBe(7000);
    expect(s.overlays).toEqual([]);
  });

  it("parses overlays and clamps transition", () => {
    const s = parseChannelPlayoutSettings({
      playout_active: true,
      transition_ms: 999999,
      overlays: [defaultOverlay({ url: "https://example.com/logo.png" })],
    });
    expect(s.playout_active).toBe(true);
    expect(s.transition_ms).toBe(60000);
    expect(s.overlays).toHaveLength(1);
  });
});

describe("mergePlayoutIntoSettings", () => {
  it("merges autopilot flag without dropping existing keys", () => {
    const merged = mergePlayoutIntoSettings({ custom_key: "keep" }, { autopilot_enabled: true });
    expect(merged).toMatchObject({
      custom_key: "keep",
      autopilot_enabled: true,
    });
  });
});
