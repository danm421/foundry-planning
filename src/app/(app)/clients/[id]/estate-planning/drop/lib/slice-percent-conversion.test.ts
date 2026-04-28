import { describe, it, expect } from "vitest";
import { sliceToAsset, assetToSlice } from "./slice-percent-conversion";

describe("slice-percent conversion", () => {
  // Tom owns 60% of a $2M account → his slice is $1.2M.
  // If Tom gifts 100% of his slice, that is 60% of the asset.
  it("100% of a 60% slice maps to 60% of the asset", () => {
    expect(sliceToAsset(1, 0.6)).toBe(0.6);
  });
  it("50% of a 60% slice maps to 30% of the asset", () => {
    expect(sliceToAsset(0.5, 0.6)).toBe(0.3);
  });
  it("assetToSlice round-trips", () => {
    expect(assetToSlice(0.3, 0.6)).toBeCloseTo(0.5, 8);
  });
  it("rejects slicePct outside (0,1]", () => {
    expect(() => sliceToAsset(0, 0.6)).toThrow();
    expect(() => sliceToAsset(1.01, 0.6)).toThrow();
  });
  it("rejects ownerSlice 0", () => {
    expect(() => sliceToAsset(0.5, 0)).toThrow();
  });
});
