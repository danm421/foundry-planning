import { describe, it, expect } from "vitest";
import { buildRetirementComparisonData } from "./view-model";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "./options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear } from "@/engine/types";

function yr(year: number, liquid: number, age: number): ProjectionYear {
  return {
    year, ages: { client: age }, expenses: { taxes: 1000 },
    portfolioAssets: { liquidTotal: liquid, cashTotal: 10, retirementTotal: 50, taxableTotal: 40 },
  } as unknown as ProjectionYear;
}

function bundle(years: ProjectionYear[], success: number, label: string) {
  return {
    clientData: { client: { retirementAge: 62, dob: "1963-01-01" } },
    projection: { years },
    scenarioLabel: label,
    monteCarlo: { summary: { successRate: success } },
  } as never;
}

describe("buildRetirementComparisonData", () => {
  const ctx = {
    clientName: "Smith",
    spouseName: null,
    scenarioLabel: "Base Case",
    bundlesByRef: {
      base: bundle([yr(2025, 100, 60), yr(2026, 90, 61), yr(2027, 80, 62)], 0.72, "Base Case"),
      "scenario:scn-1": bundle([yr(2025, 100, 60), yr(2026, 120, 61), yr(2027, 150, 62)], 0.91, "Roth + Delay"),
    },
  } as unknown as BuildDataContext;

  it("returns non-empty data with KPIs and a subtitle naming the scenario", () => {
    const data = buildRetirementComparisonData(ctx, {
      ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT, scenarioId: "scn-1",
    });
    expect(data.isEmpty).toBe(false);
    expect(data.subtitle).toContain("Roth + Delay");
    expect(data.kpis.length).toBe(4);
    expect(data.overlay.length).toBe(3);
  });

  it("returns the empty state when no scenario is selected", () => {
    const data = buildRetirementComparisonData(ctx, RETIREMENT_COMPARISON_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
  });
});
