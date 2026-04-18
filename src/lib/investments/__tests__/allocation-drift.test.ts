import { describe, it, expect } from "vitest";
import { computeDrift, type AssetClassRollup } from "../allocation";

const NAMES: Record<string, string> = {
  "ac-eq": "US Equity",
  "ac-bond": "US Bonds",
  "ac-intl": "Intl Equity",
};

function mkCurrent(entries: { id: string; pct: number }[]): AssetClassRollup[] {
  return entries.map((e, i) => ({
    id: e.id,
    name: NAMES[e.id] ?? e.id,
    sortOrder: i,
    value: e.pct * 100_000, // arbitrary, only pctOfClassified is used
    pctOfClassified: e.pct,
  }));
}

describe("computeDrift", () => {
  it("computes Current - Target for every asset class in either set", () => {
    const current = mkCurrent([
      { id: "ac-eq", pct: 0.7 },
      { id: "ac-bond", pct: 0.3 },
    ]);
    const target = [
      { assetClassId: "ac-eq", weight: 0.6 },
      { assetClassId: "ac-bond", weight: 0.4 },
    ];
    const out = computeDrift(current, target, NAMES);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(
      expect.objectContaining({
        assetClassId: "ac-eq",
        name: "US Equity",
        currentPct: 0.7,
        targetPct: 0.6,
        diffPct: expect.closeTo(0.1),
      })
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        assetClassId: "ac-bond",
        name: "US Bonds",
        currentPct: 0.3,
        targetPct: 0.4,
        diffPct: expect.closeTo(-0.1),
      })
    );
  });

  it("treats missing side as zero (classes only in current)", () => {
    const current = mkCurrent([{ id: "ac-eq", pct: 1 }]);
    const target = [
      { assetClassId: "ac-eq", weight: 0.6 },
      { assetClassId: "ac-bond", weight: 0.4 },
    ];
    const out = computeDrift(current, target, NAMES);
    const bond = out.find((r) => r.assetClassId === "ac-bond")!;
    expect(bond.currentPct).toBe(0);
    expect(bond.targetPct).toBe(0.4);
    expect(bond.diffPct).toBeCloseTo(-0.4);
  });

  it("treats missing side as zero (classes only in target)", () => {
    const current = mkCurrent([
      { id: "ac-eq", pct: 0.5 },
      { id: "ac-intl", pct: 0.5 },
    ]);
    const target = [{ assetClassId: "ac-eq", weight: 1 }];
    const out = computeDrift(current, target, NAMES);
    const intl = out.find((r) => r.assetClassId === "ac-intl")!;
    expect(intl.currentPct).toBe(0.5);
    expect(intl.targetPct).toBe(0);
    expect(intl.diffPct).toBeCloseTo(0.5);
  });

  it("sorts results by absolute drift descending", () => {
    const current = mkCurrent([
      { id: "ac-eq", pct: 0.5 },
      { id: "ac-bond", pct: 0.3 },
      { id: "ac-intl", pct: 0.2 },
    ]);
    const target = [
      { assetClassId: "ac-eq", weight: 0.49 },
      { assetClassId: "ac-bond", weight: 0.5 },
      { assetClassId: "ac-intl", weight: 0.01 },
    ];
    const out = computeDrift(current, target, NAMES);
    const absDiffs = out.map((r) => Math.abs(r.diffPct));
    expect(absDiffs).toEqual([...absDiffs].sort((a, b) => b - a));
  });

  it("returns an empty array when target is empty", () => {
    const current = mkCurrent([{ id: "ac-eq", pct: 1 }]);
    const out = computeDrift(current, [], NAMES);
    // No target → drift vs nothing. Treat as "no meaningful comparison" → return [].
    expect(out).toEqual([]);
  });
});
