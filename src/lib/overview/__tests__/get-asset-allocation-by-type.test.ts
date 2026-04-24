import { describe, it, expect } from "vitest";
import { rollupByAssetTypeGroup } from "@/lib/overview/get-asset-allocation-by-type";

describe("rollupByAssetTypeGroup", () => {
  it("sums values per group and computes percentages", () => {
    const rows = [
      { assetTypeGroup: "equities", value: 600 },
      { assetTypeGroup: "equities", value: 400 },
      { assetTypeGroup: "cash", value: 100 },
      { assetTypeGroup: "bonds", value: 400 },
    ];
    const r = rollupByAssetTypeGroup(rows);
    // Expect equities (1000, ~66.67%), bonds (400, ~26.67%), cash (100, ~6.67%) — sorted by value desc
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual(expect.objectContaining({ group: "equities", value: 1000 }));
    expect(r[0].pct).toBeCloseTo(0.6667, 3);
    expect(r[1]).toEqual(expect.objectContaining({ group: "bonds", value: 400 }));
    expect(r[2]).toEqual(expect.objectContaining({ group: "cash", value: 100 }));
  });

  it("returns empty array on empty input", () => {
    expect(rollupByAssetTypeGroup([])).toEqual([]);
  });

  it("buckets nulls as 'other'", () => {
    const r = rollupByAssetTypeGroup([{ assetTypeGroup: null, value: 50 }]);
    expect(r[0].group).toBe("other");
  });
});
