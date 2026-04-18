import { describe, it, expect } from "vitest";
import { colorForAssetClass, UNALLOCATED_COLOR } from "../palette";

describe("colorForAssetClass", () => {
  it("returns the same color for the same sortOrder across calls", () => {
    const a = colorForAssetClass({ id: "x", sortOrder: 3 });
    const b = colorForAssetClass({ id: "y", sortOrder: 3 });
    expect(a).toBe(b);
  });

  it("returns different colors for different sortOrder values", () => {
    const a = colorForAssetClass({ id: "x", sortOrder: 0 });
    const b = colorForAssetClass({ id: "y", sortOrder: 1 });
    expect(a).not.toBe(b);
  });

  it("wraps around for sortOrder beyond the palette length", () => {
    const a = colorForAssetClass({ id: "x", sortOrder: 0 });
    // Palette has 12 colors; index 12 should equal index 0.
    const b = colorForAssetClass({ id: "y", sortOrder: 12 });
    expect(a).toBe(b);
  });

  it("exposes a distinct neutral color for the Unallocated bucket", () => {
    const c = colorForAssetClass({ id: "x", sortOrder: 0 });
    expect(UNALLOCATED_COLOR).not.toBe(c);
    expect(UNALLOCATED_COLOR).toMatch(/^#/);
  });
});
