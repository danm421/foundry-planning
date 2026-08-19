// mobile/src/home/asset-groups.test.ts
//
// The Net worth tile's "By type" breakdown. The web renders the same
// `assetGroups` as a pie (asset-type-pie.tsx); the phone renders shares as
// bars, so the shares themselves are what has to be right.
import { describe, it, expect } from "vitest";
import type { NetWorthGroupLine } from "@contracts";
import { assetGroupWeights } from "./asset-groups";

const g = (label: string, total: number): NetWorthGroupLine => ({
  category: label.toLowerCase(),
  label,
  total,
});

describe("assetGroupWeights", () => {
  it("splits each group's share of the asset total", () => {
    expect(assetGroupWeights([g("Cash", 25_000), g("Retirement", 75_000)])).toEqual([
      { name: "Cash", weight: 0.25 },
      { name: "Retirement", weight: 0.75 },
    ]);
  });

  it("keeps the loader's balance-sheet order", () => {
    const out = assetGroupWeights([g("Cash", 1), g("Brokerage", 1), g("Retirement", 1)]);
    expect(out.map((o) => o.name)).toEqual(["Cash", "Brokerage", "Retirement"]);
  });

  it("returns nothing for an empty breakdown", () => {
    expect(assetGroupWeights([])).toEqual([]);
  });

  // A household whose asset accounts all sit at zero would divide by zero and
  // render NaN-wide bars.
  it("survives a zero asset total without producing NaN", () => {
    const out = assetGroupWeights([g("Cash", 0), g("Retirement", 0)]);
    expect(out).toEqual([
      { name: "Cash", weight: 0 },
      { name: "Retirement", weight: 0 },
    ]);
    for (const o of out) expect(Number.isFinite(o.weight)).toBe(true);
  });

  // Asset-side subtotals should not go negative, but an overdrawn cash account
  // can drag one under; clamping keeps the bar from inverting.
  it("clamps a negative subtotal to zero rather than inverting its bar", () => {
    const out = assetGroupWeights([g("Cash", -5_000), g("Retirement", 100_000)]);
    expect(out[0].weight).toBe(0);
    expect(out[1].weight).toBeGreaterThan(0);
  });
});
