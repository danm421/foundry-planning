import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine";
import {
  buildPortfolioDeltaSegments,
  buildPortfolioSingleSeries,
  liquidPortfolioTotal,
} from "../portfolio-bars-data";

/** Minimal ProjectionYear with a given liquid portfolio total in `taxableTotal`. */
function yr(year: number, total: number): ProjectionYear {
  return {
    year,
    portfolioAssets: {
      taxableTotal: total,
      cashTotal: 0,
      retirementTotal: 0,
      lifeInsuranceTotal: 0,
    },
  } as unknown as ProjectionYear;
}

describe("liquidPortfolioTotal", () => {
  it("sums taxable, cash, retirement, and life insurance buckets", () => {
    const y = {
      portfolioAssets: {
        taxableTotal: 100,
        cashTotal: 50,
        retirementTotal: 200,
        lifeInsuranceTotal: 25,
      },
    } as unknown as ProjectionYear;
    expect(liquidPortfolioTotal(y)).toBe(375);
  });
});

describe("buildPortfolioDeltaSegments", () => {
  it("caps the scenario above the floor when it leads the base case", () => {
    const seg = buildPortfolioDeltaSegments(
      [yr(2030, 1000)],
      new Map([[2030, 600]]),
    );
    expect(seg.floor).toEqual([600]);
    expect(seg.scenarioAhead).toEqual([400]);
    expect(seg.baseAhead).toEqual([0]);
    expect(seg.scenarioTotals).toEqual([1000]);
  });

  it("caps the base above the floor when it leads the scenario", () => {
    const seg = buildPortfolioDeltaSegments(
      [yr(2030, 600)],
      new Map([[2030, 1000]]),
    );
    expect(seg.floor).toEqual([600]);
    expect(seg.scenarioAhead).toEqual([0]);
    expect(seg.baseAhead).toEqual([400]);
  });

  it("keeps the base case at full height when the scenario is underwater", () => {
    const seg = buildPortfolioDeltaSegments(
      [yr(2064, -4_579_399)],
      new Map([[2064, 12_000_000]]),
    );
    // Scenario clamped to 0 → flat floor/green; base renders its full projection.
    expect(seg.floor).toEqual([0]);
    expect(seg.scenarioAhead).toEqual([0]);
    expect(seg.baseAhead).toEqual([12_000_000]);
    // Raw negative total preserved for the tooltip.
    expect(seg.scenarioTotals).toEqual([-4_579_399]);
  });

  it("keeps the scenario at full height when the base case is underwater", () => {
    const seg = buildPortfolioDeltaSegments(
      [yr(2064, 8_000_000)],
      new Map([[2064, -1_000_000]]),
    );
    expect(seg.floor).toEqual([0]);
    expect(seg.scenarioAhead).toEqual([8_000_000]);
    expect(seg.baseAhead).toEqual([0]);
  });

  it("falls back to the scenario value when the base case lacks that year", () => {
    const seg = buildPortfolioDeltaSegments([yr(2030, 800)], new Map());
    expect(seg.floor).toEqual([800]);
    expect(seg.scenarioAhead).toEqual([0]);
    expect(seg.baseAhead).toEqual([0]);
  });
});

describe("buildPortfolioSingleSeries", () => {
  it("passes positive totals through unchanged", () => {
    const s = buildPortfolioSingleSeries([yr(2030, 1000), yr(2031, 1200)]);
    expect(s.data).toEqual([1000, 1200]);
    expect(s.scenarioTotals).toEqual([1000, 1200]);
  });

  it("clamps a negative total to a flat 0 bar, keeping the raw value", () => {
    const s = buildPortfolioSingleSeries([yr(2064, -250_000)]);
    expect(s.data).toEqual([0]);
    expect(s.scenarioTotals).toEqual([-250_000]);
  });
});
