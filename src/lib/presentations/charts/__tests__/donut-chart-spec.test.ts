import { describe, it, expect } from "vitest";
import { segmentAngles, donutArcPath, buildAllocationDonutSpec } from "../donut-chart-spec";
import type { HouseholdAllocation } from "@/lib/investments/allocation";

describe("segmentAngles", () => {
  it("returns proportional [start,end] spanning the full circle", () => {
    const a = segmentAngles([1, 3]); // 25% / 75%
    expect(a[0].start).toBeCloseTo(0);
    expect(a[0].end).toBeCloseTo(Math.PI / 2);
    expect(a[1].end).toBeCloseTo(Math.PI * 2);
  });
  it("returns [] for all-zero input", () => {
    expect(segmentAngles([0, 0])).toEqual([]);
  });
});

describe("donutArcPath", () => {
  it("emits an SVG path string starting with a move command", () => {
    const d = donutArcPath(50, 50, 20, 40, 0, Math.PI / 2);
    expect(d.startsWith("M")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
  });
});

describe("buildAllocationDonutSpec", () => {
  // HouseholdAllocation.byAssetClass is AssetClassRollup[]: { id, name, sortOrder, value, pctOfClassified, assetType }
  // HouseholdAllocation.byAssetType is AssetTypeRollup[]: { id, label, sortOrder, value, pctOfClassified }
  const household: HouseholdAllocation = {
    byAssetClass: [
      { id: "eq", name: "US Equity", sortOrder: 0, value: 75, pctOfClassified: 0.75, assetType: "equities" },
      { id: "bd", name: "Bonds", sortOrder: 1, value: 25, pctOfClassified: 0.25, assetType: "taxable_bonds" },
    ],
    byAssetType: [
      { id: "equities", label: "Equities", sortOrder: 0, value: 75, pctOfClassified: 0.75 },
      { id: "taxable_bonds", label: "Taxable Bonds", sortOrder: 1, value: 25, pctOfClassified: 0.25 },
    ],
    totalClassifiedValue: 100,
    totalInvestableValue: 100,
    unallocatedValue: 0,
    excludedNonInvestableValue: 0,
    contributionsByAssetClass: {},
    contributionsByAssetType: {},
    unallocatedContributions: [],
  };

  it("builds a single ring for the detailed view", () => {
    const spec = buildAllocationDonutSpec(household, "detailed");
    expect(spec.rings).toHaveLength(1);
    expect(spec.rings[0].segments.map((s) => s.label)).toEqual(["US Equity", "Bonds"]);
    expect(spec.legend[0].pct).toBeCloseTo(0.75);
  });

  it("builds two nested rings for the combined view", () => {
    const spec = buildAllocationDonutSpec(household, "combined");
    expect(spec.rings).toHaveLength(2);
  });

  it("appends an Unallocated segment when unallocated value is present", () => {
    const spec = buildAllocationDonutSpec({ ...household, unallocatedValue: 50 }, "high_level");
    expect(spec.rings[0].segments.some((s) => s.label === "Unallocated")).toBe(true);
  });

  it("builds a donut from a minimal portfolio-like AllocationDonutInput", () => {
    const input = {
      byAssetClass: [
        { id: "eq", name: "US Equity", sortOrder: 0, value: 0.6, assetType: "equities" as const },
        { id: "bd", name: "Bonds", sortOrder: 1, value: 0.4, assetType: "taxable_bonds" as const },
      ],
      byAssetType: [
        { id: "equities" as const, label: "Equities", value: 0.6 },
        { id: "taxable_bonds" as const, label: "Taxable Bonds", value: 0.4 },
      ],
      unallocatedValue: 0,
    };
    const spec = buildAllocationDonutSpec(input, "detailed");
    expect(spec.legend.map((l) => l.label)).toEqual(["US Equity", "Bonds"]);
    expect(spec.legend[0]!.pct).toBeCloseTo(0.6);
  });
});
