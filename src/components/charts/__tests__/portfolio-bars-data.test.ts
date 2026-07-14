import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine";
import {
  buildPortfolioDeltaSegments,
  buildPortfolioSingleSeries,
  liquidPortfolioTotal,
} from "../portfolio-bars-data";

/** Minimal ProjectionYear with a given liquid portfolio total. */
function yr(year: number, total: number): ProjectionYear {
  return {
    year,
    portfolioAssets: {
      taxableTotal: total,
      cashTotal: 0,
      retirementTotal: 0,
      lifeInsuranceTotal: 0,
      accessibleTrustAssetsTotal: 0,
      liquidTotal: total,
    },
  } as unknown as ProjectionYear;
}

describe("liquidPortfolioTotal", () => {
  it("returns the canonical engine liquidTotal (incl. accessible trust assets)", () => {
    const y = {
      portfolioAssets: {
        taxableTotal: 100,
        cashTotal: 50,
        retirementTotal: 200,
        lifeInsuranceTotal: 25,
        accessibleTrustAssetsTotal: 30,
        // engine field = 100+50+200+25+30; the consumer reads it as the source of truth
        liquidTotal: 405,
      },
    } as unknown as ProjectionYear;
    expect(liquidPortfolioTotal(y)).toBe(405);
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

  it("treats a missing base year as $0 so the scenario shows fully ahead", () => {
    const seg = buildPortfolioDeltaSegments([yr(2030, 800)], new Map());
    // No base counterpart → base is $0 → the whole bar is "scenario ahead"
    // (green), NOT a misleading all-blue "identical to base" floor.
    expect(seg.floor).toEqual([0]);
    expect(seg.scenarioAhead).toEqual([800]);
    expect(seg.baseAhead).toEqual([0]);
    expect(seg.scenarioTotals).toEqual([800]);
  });

  it("does not paint trailing years all-blue when the base projection ends early", () => {
    // Regression: base runs 2030–2031; the scenario runs 2030–2033 (its horizon
    // was recomputed longer). The trailing 2032–2033 have no base counterpart
    // and must render as scenario-ahead (green), never as an identical all-blue
    // floor. Matching years still compute a real floor + delta.
    const seg = buildPortfolioDeltaSegments(
      [yr(2030, 1000), yr(2031, 1100), yr(2032, 1200), yr(2033, 1300)],
      new Map([
        [2030, 900],
        [2031, 950],
      ]),
    );
    expect(seg.floor).toEqual([900, 950, 0, 0]);
    expect(seg.scenarioAhead).toEqual([100, 150, 1200, 1300]);
    expect(seg.baseAhead).toEqual([0, 0, 0, 0]);
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
