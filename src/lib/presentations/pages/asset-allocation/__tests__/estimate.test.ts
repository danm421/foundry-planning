import { describe, it, expect } from "vitest";
import { estimateAssetAllocationPageCount } from "../estimate-page-count";
import type { AssetAllocationData } from "../view-model";

const base: AssetAllocationData = {
  subtitle: "All Liquid Assets",
  currentDonut: { kind: "donut", size: 150, rings: [{ segments: [] }], legend: [] },
  benchmarkDonut: null,
  tableRows: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, value: 1, currentPct: 0.2, targetPct: null })),
  driftRows: null,
  disclosure: "Investable assets only.",
};

describe("estimateAssetAllocationPageCount", () => {
  it("is one page for a short table without drift", () => {
    expect(estimateAssetAllocationPageCount(base)).toBe(1);
  });
  it("spills to two pages with a long table and drift", () => {
    const big: AssetAllocationData = {
      ...base,
      tableRows: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, value: 1, currentPct: 0.03, targetPct: 0.03 })),
      // Non-empty driftRows required: tableHeavy && hasDrift → 2
      driftRows: [{ assetClassId: "eq", name: "US Equity", currentPct: 0.5, targetPct: 0.6, diffPct: 0.1 }],
    };
    expect(estimateAssetAllocationPageCount(big)).toBe(2);
  });
});
