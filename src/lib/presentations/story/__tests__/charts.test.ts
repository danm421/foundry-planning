import { describe, it, expect } from "vitest";
import { buildStoryCharts } from "../charts";
import type { ProjectionYear } from "@/engine/types";

/**
 * Two years, enough to prove the arrays come back keyed by year.
 *
 * `portfolioAssets.{cashTotal,taxableTotal,retirementTotal}` are the fields
 * `portfolioBars` actually reads (`retirement-summary/aggregate.ts`); `taxResult`
 * is left absent, which `buildTaxPaidBars` treats as a year with no tax bar
 * rather than a fixture error.
 */
function years(): ProjectionYear[] {
  return [
    { year: 2026, portfolioAssets: { cashTotal: 10_000, taxableTotal: 20_000, retirementTotal: 70_000 } },
    { year: 2027, portfolioAssets: { cashTotal: 12_000, taxableTotal: 22_000, retirementTotal: 80_000 } },
  ] as unknown as ProjectionYear[];
}

describe("buildStoryCharts", () => {
  it("returns the portfolio bars the chart draws, one per projection year", () => {
    const charts = buildStoryCharts({ years: years(), estate: null });
    expect(charts.portfolio.map((b) => b.year)).toEqual([2026, 2027]);
  });

  it("returns null for the estate chart when there is no estate to report", () => {
    const charts = buildStoryCharts({ years: years(), estate: null });
    expect(charts.estate).toBeNull();
  });

  it("passes the estate chart through untouched — one object, not a second derivation", () => {
    const estate = {
      comparison: "todayVsEndOfLife" as const,
      bars: [
        { label: "Today", netToHeirs: 1, federal: 0, state: 0, probate: 0, ird: 0, debts: 0, total: 1 },
        { label: "End of Life", netToHeirs: 2, federal: 0, state: 0, probate: 0, ird: 0, debts: 0, total: 2 },
      ],
    };
    const charts = buildStoryCharts({ years: years(), estate });
    // Identity, not a deep match: the comparison this module is asked to carry
    // must reach `StoryChartData` unchanged, alongside the bars.
    expect(charts.estate).toBe(estate);
  });
});
