import { describe, it, expect } from "vitest";
import {
  buildProjectedValueRefreshPreview,
  validateProjectedRefreshRequest,
  resolveProjectedClass,
  type ExistingProjectedClass,
  type ProjectedValueRefreshPreview,
} from "../cma-projected-value-refresh";
import projected from "../cma-projected.generated.json";

// Build an ExistingProjectedClass straight from a generated entry (so "no diff" is exact).
function fromGenerated(
  name: string,
  id: string,
  overrides: Partial<ExistingProjectedClass> = {},
): ExistingProjectedClass {
  const g = projected.assetClasses.find((c) => c.name === name)!;
  return {
    id,
    name,
    slug: g.slug ?? null,
    geometricReturn: String(g.geometricReturn),
    arithmeticMean: String(g.arithmeticMean),
    volatility: String(g.volatility),
    ...overrides,
  };
}

describe("buildProjectedValueRefreshPreview", () => {
  it("reports no changes when every projected value matches the generated file", () => {
    const existing = projected.assetClasses.map((g, i) => fromGenerated(g.name, `id-${i}`));
    const preview = buildProjectedValueRefreshPreview(existing);
    expect(preview.classChanges).toEqual([]);
    expect(preview.generatedAt).toBe(projected.meta.generatedAt);
  });

  it("flags a stale projected class (old 0.1040 clone -> generated)", () => {
    const stale = fromGenerated("US Large Cap", "us", { geometricReturn: "0.1040" });
    const preview = buildProjectedValueRefreshPreview([stale]);
    const change = preview.classChanges.find((c) => c.id === "us")!;
    expect(change.changes.map((c) => c.field)).toContain("geometricReturn");
    const geo = change.changes.find((c) => c.field === "geometricReturn")!;
    expect(geo.current).toBe("0.1040");
    expect(geo.next).toBe("0.07");
  });

  it("ignores numeric-string format noise (0.0700 == 0.07)", () => {
    const us = fromGenerated("US Large Cap", "us", { geometricReturn: "0.0700" });
    const preview = buildProjectedValueRefreshPreview([us]);
    expect(preview.classChanges).toEqual([]);
  });

  it("ignores firm classes with no generated mapping", () => {
    const legacy: ExistingProjectedClass = {
      id: "lg",
      name: "US Aggregate Bond",
      slug: "us_aggregate_bond",
      geometricReturn: "0.05",
      arithmeticMean: "0.06",
      volatility: "0.10",
    };
    const preview = buildProjectedValueRefreshPreview([legacy]);
    expect(preview.classChanges).toEqual([]);
  });

  it("matches by slug first, then name", () => {
    // Renamed-but-same-slug class still maps to its generated entry.
    const renamed = fromGenerated("US Large Cap", "us", {
      name: "US Large Cap (renamed)",
      geometricReturn: "0.1040",
    });
    const preview = buildProjectedValueRefreshPreview([renamed]);
    expect(preview.classChanges.find((c) => c.id === "us")).toBeDefined();
  });
});

describe("resolveProjectedClass", () => {
  it("resolves by name when slug is null", () => {
    expect(resolveProjectedClass("US Large Cap", null)?.geometricReturn).toBe(0.07);
  });
  it("returns undefined for an unknown class", () => {
    expect(resolveProjectedClass("Nope", "nope")).toBeUndefined();
  });
});

describe("validateProjectedRefreshRequest", () => {
  const base: ProjectedValueRefreshPreview = {
    generatedAt: "2026-06-01",
    classChanges: [{ id: "a", name: "US Large Cap", changes: [] }],
  };

  it("rejects a classId with no pending changes", () => {
    expect(validateProjectedRefreshRequest(base, { classIds: ["nope"] })).toMatch(/no pending/);
  });
  it("rejects an empty request", () => {
    expect(validateProjectedRefreshRequest(base, { classIds: [] })).toMatch(/Nothing selected/);
  });
  it("accepts a valid selection", () => {
    expect(validateProjectedRefreshRequest(base, { classIds: ["a"] })).toBeNull();
  });
});
