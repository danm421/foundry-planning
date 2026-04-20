import { describe, it, expect } from "vitest";
import { colorForAssetClass, UNALLOCATED_COLOR, ASSET_TYPE_PALETTE, colorForAssetType, shadeForClassInType } from "../palette";
import { ASSET_TYPE_IDS } from "../asset-types";

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

describe("ASSET_TYPE_PALETTE", () => {
  it("defines a color for every asset type id", () => {
    for (const id of ASSET_TYPE_IDS) {
      expect(ASSET_TYPE_PALETTE[id]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("colorForAssetType returns the palette color", () => {
    expect(colorForAssetType("equities")).toBe(ASSET_TYPE_PALETTE.equities);
    expect(colorForAssetType("cash")).toBe(ASSET_TYPE_PALETTE.cash);
  });
});

describe("shadeForClassInType", () => {
  it("returns the base color at index 0 when there is a single class", () => {
    expect(shadeForClassInType("equities", 0, 1)).toBe(ASSET_TYPE_PALETTE.equities);
  });

  it("returns distinct shades for each index when there are multiple classes", () => {
    const total = 5;
    const shades = Array.from({ length: total }, (_, i) =>
      shadeForClassInType("equities", i, total),
    );
    const uniq = new Set(shades);
    expect(uniq.size).toBe(total);
    // All shades are valid hex strings.
    for (const s of shades) {
      expect(s).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("is deterministic — same inputs give the same shade", () => {
    const a = shadeForClassInType("taxable_bonds", 2, 4);
    const b = shadeForClassInType("taxable_bonds", 2, 4);
    expect(a).toBe(b);
  });

  it("clamps out-of-range indices safely rather than throwing", () => {
    expect(() => shadeForClassInType("other", -1, 3)).not.toThrow();
    expect(() => shadeForClassInType("other", 99, 3)).not.toThrow();
  });
});
