import { describe, expect, it } from "vitest";
import { sanitizeSearch } from "./search";

describe("sanitizeSearch", () => {
  it("returns undefined for empty input", () => {
    expect(sanitizeSearch()).toBeUndefined();
    expect(sanitizeSearch("   ")).toBeUndefined();
  });

  it("strips ilike wildcards", () => {
    expect(sanitizeSearch("100%_\\")).toBe("100");
  });

  it("caps length at 200 characters", () => {
    const long = "a".repeat(300);
    expect(sanitizeSearch(long)?.length).toBe(200);
  });
});
