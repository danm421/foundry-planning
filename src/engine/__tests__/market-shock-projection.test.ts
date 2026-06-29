import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";

/** Sum of market-exposed (retirement + taxable) balances in a projection year. */
function marketBalance(year: ReturnType<typeof runProjection>[number]): number {
  return year.portfolioAssets.retirementTotal + year.portfolioAssets.taxableTotal;
}

describe("market shock — projection integration", () => {
  it("drops market-exposed balances in the shock year vs. no shock", () => {
    const SHOCK_YEAR = 2030;
    const baseData = buildClientData();
    const shockData = buildClientData({
      planSettings: { ...basePlanSettings, marketShock: { year: SHOCK_YEAR, drawdownPct: 0.3 } },
    });

    const baseRun = runProjection(baseData);
    const shockRun = runProjection(shockData);

    const findYear = (rows: typeof baseRun, y: number) => rows.find((r) => r.year === y)!;

    const baseShockYear = findYear(baseRun, SHOCK_YEAR);
    const shockShockYear = findYear(shockRun, SHOCK_YEAR);
    // Market-exposed balances should be materially lower in the shock run.
    expect(marketBalance(shockShockYear)).toBeLessThan(marketBalance(baseShockYear) * 0.85);

    // The pre-shock year is unaffected.
    const preBase = findYear(baseRun, SHOCK_YEAR - 1);
    const preShock = findYear(shockRun, SHOCK_YEAR - 1);
    expect(marketBalance(preShock)).toBeCloseTo(marketBalance(preBase), 0);
  });
});
