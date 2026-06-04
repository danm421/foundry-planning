import { describe, it, expect } from "vitest";
import { buildRetirementComparisonMetrics } from "./metrics";
import type { ProjectionYear } from "@/engine/types";

// Minimal ProjectionYear stub — only the fields the metrics read.
function yr(year: number, liquid: number, ages: { client: number }): ProjectionYear {
  return {
    year,
    ages,
    expenses: { taxes: 1000 },
    portfolioAssets: {
      liquidTotal: liquid,
      cashTotal: liquid * 0.1,
      retirementTotal: liquid * 0.5,
      taxableTotal: liquid * 0.4,
    },
  } as unknown as ProjectionYear;
}

describe("buildRetirementComparisonMetrics", () => {
  const baseYears = [yr(2025, 100, { client: 60 }), yr(2026, 90, { client: 61 }), yr(2027, 80, { client: 62 })];
  const scnYears = [yr(2025, 100, { client: 60 }), yr(2026, 120, { client: 61 }), yr(2027, 150, { client: 62 })];

  it("computes the overlay floor/ahead/behind per year", () => {
    const m = buildRetirementComparisonMetrics({
      baseYears, scenarioYears: scnYears,
      baseSuccess: 0.72, scenarioSuccess: 0.91,
      retirementYear: 2026,
    });
    // 2026: base 90, scenario 120 → floor 90, scenarioAhead 30, baseAhead 0
    const y2026 = m.overlay.find((o) => o.year === 2026)!;
    expect(y2026.floor).toBe(90);
    expect(y2026.scenarioAhead).toBe(30);
    expect(y2026.baseAhead).toBe(0);
  });

  it("builds the portfolio matrix at retirement + end-of-life", () => {
    const m = buildRetirementComparisonMetrics({
      baseYears, scenarioYears: scnYears,
      baseSuccess: 0.72, scenarioSuccess: 0.91,
      retirementYear: 2026,
    });
    expect(m.matrix.retirementYear).toBe(2026);
    expect(m.matrix.endOfLifeYear).toBe(2027);
    expect(m.matrix.scenarioAtEnd.total).toBe(150);
    expect(m.matrix.baseAtRetirement.total).toBe(90);
  });

  it("emits a PoS KPI with a points delta and good direction", () => {
    const m = buildRetirementComparisonMetrics({
      baseYears, scenarioYears: scnYears,
      baseSuccess: 0.72, scenarioSuccess: 0.91,
      retirementYear: 2026,
    });
    const pos = m.kpis.find((k) => k.label === "Probability of Success")!;
    expect(pos.base).toBe("72%");
    expect(pos.scenario).toBe("91%");
    expect(pos.deltaLabel).toBe("+19 pts");
    expect(pos.direction).toBe(1);
  });
});
