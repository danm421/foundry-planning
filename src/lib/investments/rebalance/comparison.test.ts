import { describe, it, expect } from "vitest";
import { toNamedWeights, buildAssetMixDelta, buildTradeSummary } from "./comparison";

const names = new Map([
  ["us", "US Large Cap"],
  ["bond", "Bonds"],
  ["reit", "REIT"],
]);

describe("toNamedWeights", () => {
  it("labels weights and drops the unknowns to a fallback name", () => {
    const out = toNamedWeights([{ assetClassId: "us", weight: 0.6 }], names);
    expect(out[0]).toEqual({ assetClassId: "us", name: "US Large Cap", weight: 0.6 });
  });
});

describe("buildAssetMixDelta", () => {
  it("computes target − current across the union of asset classes", () => {
    const current = [{ assetClassId: "us", name: "US Large Cap", weight: 0.8 }];
    const target = [
      { assetClassId: "us", name: "US Large Cap", weight: 0.6 },
      { assetClassId: "bond", name: "Bonds", weight: 0.4 },
    ];
    const out = buildAssetMixDelta(current, target);
    const us = out.find((r) => r.assetClassId === "us")!;
    const bond = out.find((r) => r.assetClassId === "bond")!;
    expect(us.diffPct).toBeCloseTo(-0.2, 10);
    expect(bond.diffPct).toBeCloseTo(0.4, 10);
  });
});

describe("buildTradeSummary", () => {
  it("turns weight deltas into dollar buys/sells", () => {
    const current = [{ assetClassId: "us", name: "US Large Cap", weight: 1 }];
    const target = [
      { assetClassId: "us", name: "US Large Cap", weight: 0.6 },
      { assetClassId: "bond", name: "Bonds", weight: 0.4 },
    ];
    const out = buildTradeSummary(current, target, 100000);
    const us = out.find((r) => r.assetClassId === "us")!;
    const bond = out.find((r) => r.assetClassId === "bond")!;
    expect(us.deltaValue).toBeCloseTo(-40000, 6);
    expect(us.action).toBe("sell");
    expect(bond.deltaValue).toBeCloseTo(40000, 6);
    expect(bond.action).toBe("buy");
  });
});
