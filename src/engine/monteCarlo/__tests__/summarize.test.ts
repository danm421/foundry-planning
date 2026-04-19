import { describe, it, expect } from "vitest";
import { percentiles, summarizeMonteCarlo } from "../summarize";
import type { MonteCarloResult } from "../run";
import type { ClientInfo, PlanSettings } from "../../types";

// ── percentiles helper ────────────────────────────────────────────────────
describe("percentiles (linear interpolation)", () => {
  it("returns the exact values for a sorted, evenly-spaced sample", () => {
    const values = [0, 25, 50, 75, 100];
    const out = percentiles(values, [0, 0.25, 0.5, 0.75, 1]);
    expect(out).toEqual([0, 25, 50, 75, 100]);
  });

  it("interpolates between adjacent values", () => {
    // n=5 → p50 = values[2] = 50. p[0.1] falls between values[0]=0 and values[1]=25.
    // Linear interpolation at rank 0.4 → 0 + 0.4 * 25 = 10.
    const out = percentiles([0, 25, 50, 75, 100], [0.1]);
    expect(out[0]).toBeCloseTo(10, 6);
  });

  it("accepts unsorted input and sorts internally", () => {
    const out = percentiles([100, 25, 0, 50, 75], [0.5]);
    expect(out[0]).toBe(50);
  });

  it("handles a single value by returning it for every probability", () => {
    expect(percentiles([42], [0, 0.5, 1])).toEqual([42, 42, 42]);
  });

  it("handles the empty array by returning NaN for every probability", () => {
    const out = percentiles([], [0.5]);
    expect(out.every(Number.isNaN)).toBe(true);
  });

  it("clamps probabilities outside [0, 1] to the endpoints", () => {
    expect(percentiles([10, 20, 30], [-0.5, 1.5])).toEqual([10, 30]);
  });
});

// ── summarizeMonteCarlo ───────────────────────────────────────────────────

// Minimal client + plan settings for shape tests. The summarizer only touches
// client.dateOfBirth / spouseDob and planSettings.planStartYear.
const BASE_CLIENT: ClientInfo = {
  firstName: "Test",
  lastName: "Client",
  dateOfBirth: "1987-04-15", // planStart 2026 → age 39
  retirementAge: 65,
  planEndAge: 95,
  spouseDob: "1989-07-20", // age 37 at 2026
  filingStatus: "married_joint",
};
const BASE_PLAN: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2028, // 3 years for easy testing
};

function makeResult(partial: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    requestedTrials: 5,
    trialsRun: 5,
    successfulTrials: 3,
    successRate: 0.6,
    endingLiquidAssets: [100, 200, 300, 400, 500],
    byYearLiquidAssetsPerTrial: [
      [110, 120, 100],
      [210, 220, 200],
      [310, 320, 300],
      [410, 420, 400],
      [510, 520, 500],
    ],
    aborted: false,
    ...partial,
  };
}

describe("summarizeMonteCarlo — top-line", () => {
  it("copies counts and derives failureRate = 1 − successRate", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    expect(s.requestedTrials).toBe(5);
    expect(s.trialsRun).toBe(5);
    expect(s.aborted).toBe(false);
    expect(s.successRate).toBe(0.6);
    expect(s.failureRate).toBeCloseTo(0.4, 10);
  });

  it("computes terminal ending distribution from endingLiquidAssets", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    // [100, 200, 300, 400, 500]
    expect(s.ending.p50).toBe(300);
    expect(s.ending.p20).toBeCloseTo(180, 6); // rank 0.8 → 100 + 0.8*(200-100)=180
    expect(s.ending.p80).toBeCloseTo(420, 6);
    expect(s.ending.min).toBe(100);
    expect(s.ending.max).toBe(500);
    expect(s.ending.mean).toBeCloseTo(300, 6);
  });
});

describe("summarizeMonteCarlo — byYear", () => {
  it("produces one row per simulated year", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    expect(s.byYear.length).toBe(3);
    expect(s.byYear.map((y) => y.year)).toEqual([2026, 2027, 2028]);
  });

  it("includes client + spouse age when spouseDob is present", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    // 2026 − 1987 = 39; 2026 − 1989 = 37
    expect(s.byYear[0].age).toEqual({ client: 39, spouse: 37 });
    expect(s.byYear[2].age).toEqual({ client: 41, spouse: 39 });
  });

  it("omits spouse age when spouseDob is absent", () => {
    const single: ClientInfo = { ...BASE_CLIENT, spouseDob: undefined };
    const s = summarizeMonteCarlo(makeResult(), {
      client: single,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    expect(s.byYear[0].age).toEqual({ client: 39 });
  });

  it("computes percentile balances per year across trials", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    // year 0 values across trials: [110, 210, 310, 410, 510]; p50 = 310
    expect(s.byYear[0].balance.p50).toBe(310);
    expect(s.byYear[0].balance.min).toBe(110);
    expect(s.byYear[0].balance.max).toBe(510);
  });

  it("computes CAGR from plan start", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 100,
    });
    // byYear[0] is END of year 1 (1 year elapsed); p50 balance = 310; CAGR = 310/100 - 1 = 2.10
    expect(s.byYear[0].cagrFromStart).not.toBeNull();
    expect(s.byYear[0].cagrFromStart!.p50).toBeCloseTo(2.10, 6);
    // byYear[2] is END of year 3 (3 years elapsed); p50 balance = 300; CAGR = (300/100)^(1/3) - 1
    const expected = Math.pow(3, 1 / 3) - 1;
    expect(s.byYear[2].cagrFromStart!.p50).toBeCloseTo(expected, 6);
  });

  it("CAGR is null when startingLiquidBalance is 0 (undefined growth from zero)", () => {
    const s = summarizeMonteCarlo(makeResult(), {
      client: BASE_CLIENT,
      planSettings: BASE_PLAN,
      startingLiquidBalance: 0,
    });
    expect(s.byYear[0].cagrFromStart).toBeNull();
  });
});

describe("summarizeMonteCarlo — edge cases", () => {
  it("handles zero trials gracefully (aborted-before-first-trial case)", () => {
    const s = summarizeMonteCarlo(
      makeResult({
        requestedTrials: 10,
        trialsRun: 0,
        successfulTrials: 0,
        successRate: 0,
        endingLiquidAssets: [],
        byYearLiquidAssetsPerTrial: [],
        aborted: true,
      }),
      { client: BASE_CLIENT, planSettings: BASE_PLAN, startingLiquidBalance: 100 },
    );
    expect(s.aborted).toBe(true);
    expect(s.trialsRun).toBe(0);
    expect(s.byYear).toEqual([]);
    expect(Number.isNaN(s.ending.p50)).toBe(true);
    expect(Number.isNaN(s.ending.mean)).toBe(true);
  });
});
