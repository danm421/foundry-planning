import { describe, it, expect } from "vitest";
import {
  buildValueRefreshPreview,
  validateRefreshRequest,
  type ExistingValueClass,
  type ValueRefreshPreview,
} from "../cma-value-refresh";
import { DEFAULT_ASSET_CLASSES, DEFAULT_CORRELATIONS } from "../cma-seed";

// Build an ExistingValueClass straight from a default (so "no diff" is exact).
function fromDefault(
  name: string,
  id: string,
  overrides: Partial<ExistingValueClass> = {},
): ExistingValueClass {
  const def = DEFAULT_ASSET_CLASSES.find((d) => d.name === name)!;
  return {
    id,
    name,
    geometricReturn: String(def.geometricReturn),
    arithmeticMean: String(def.arithmeticMean),
    volatility: String(def.volatility),
    pctOrdinaryIncome: String(def.pctOrdinaryIncome),
    pctLtCapitalGains: String(def.pctLtCapitalGains),
    pctQualifiedDividends: String(def.pctQualifiedDividends),
    pctTaxExempt: String(def.pctTaxExempt),
    assetType: def.assetType,
    ...overrides,
  };
}

describe("buildValueRefreshPreview", () => {
  it("reports no changes when every value matches the current defaults", () => {
    const existing = DEFAULT_ASSET_CLASSES.map((d, i) => fromDefault(d.name, `id-${i}`));
    const nameToId = new Map(existing.map((c) => [c.name, c.id]));
    const corr = DEFAULT_CORRELATIONS.map((dc) => ({
      idA: nameToId.get(dc.classA)!,
      idB: nameToId.get(dc.classB)!,
      correlation: String(dc.correlation),
    }));
    const preview = buildValueRefreshPreview(existing, corr);
    expect(preview.classChanges).toEqual([]);
    expect(preview.correlationPairsToRefresh).toBe(0);
    expect(preview.missingStandardClasses).toEqual([]);
  });

  it("ignores numeric-string format noise (0.1040 == 0.104)", () => {
    const def = DEFAULT_ASSET_CLASSES.find((d) => d.name === "US Large Cap")!;
    const us = fromDefault("US Large Cap", "us", {
      geometricReturn: Number(def.geometricReturn).toFixed(4), // e.g. "0.1040"
    });
    const preview = buildValueRefreshPreview([us], []);
    expect(preview.classChanges).toEqual([]);
  });

  it("flags changed value fields for a stale class", () => {
    const us = fromDefault("US Large Cap", "us", {
      geometricReturn: "0.1145",
      volatility: "0.18",
    });
    const preview = buildValueRefreshPreview([us], []);
    const change = preview.classChanges.find((c) => c.id === "us")!;
    const fields = change.changes.map((c) => c.field);
    expect(fields).toContain("geometricReturn");
    expect(fields).toContain("volatility");
    expect(fields).not.toContain("arithmeticMean");
  });

  it("never reports legacy (non-standard) classes", () => {
    const legacy: ExistingValueClass = {
      id: "lg",
      name: "US Aggregate Bond",
      geometricReturn: "0.05",
      arithmeticMean: "0.06",
      volatility: "0.10",
      pctOrdinaryIncome: "1",
      pctLtCapitalGains: "0",
      pctQualifiedDividends: "0",
      pctTaxExempt: "0",
      assetType: "taxable_bonds",
    };
    const preview = buildValueRefreshPreview([legacy], []);
    expect(preview.classChanges).toEqual([]);
  });

  it("counts standard correlation pairs that differ or are missing", () => {
    const a = fromDefault("US Large Cap", "a");
    const b = fromDefault("US Mid Cap", "b");
    // store one wrong correlation; the default for this equity pair is non-zero
    const preview = buildValueRefreshPreview(
      [a, b],
      [{ idA: "a", idB: "b", correlation: "0.0" }],
    );
    expect(preview.correlationPairsToRefresh).toBe(1);
  });

  it("lists standard classes the firm is missing (informational)", () => {
    const preview = buildValueRefreshPreview([fromDefault("US Large Cap", "a")], []);
    expect(preview.missingStandardClasses).toContain("Inflation");
    expect(preview.missingStandardClasses).not.toContain("US Large Cap");
  });
});

describe("validateRefreshRequest", () => {
  const base: ValueRefreshPreview = {
    generatedAt: "2026-05-31",
    classChanges: [{ id: "a", name: "US Large Cap", changes: [] }],
    missingStandardClasses: [],
    correlationPairsToRefresh: 1,
  };

  it("rejects a classId with no pending changes", () => {
    expect(
      validateRefreshRequest(base, { classIds: ["nope"], refreshCorrelations: false }),
    ).toMatch(/no pending/);
  });

  it("rejects an empty request", () => {
    expect(
      validateRefreshRequest(base, { classIds: [], refreshCorrelations: false }),
    ).toMatch(/Nothing selected/);
  });

  it("accepts a valid class selection", () => {
    expect(
      validateRefreshRequest(base, { classIds: ["a"], refreshCorrelations: true }),
    ).toBeNull();
  });

  it("accepts a correlation-only refresh", () => {
    expect(
      validateRefreshRequest(base, { classIds: [], refreshCorrelations: true }),
    ).toBeNull();
  });
});
