import { describe, it, expect } from "vitest";
import { computeEndingNetWorth, computeYearsPortfolioSurvives, computeEstateTotals } from "../kpi";
import type { ProjectionYear } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

function year(total: number, liquid?: number): ProjectionYear {
  return {
    portfolioAssets: { total, cash: liquid ?? total } as never,
  } as unknown as ProjectionYear;
}

describe("computeEndingNetWorth", () => {
  it("returns the last year's portfolioAssets.total", () => {
    expect(computeEndingNetWorth([year(100), year(250), year(900)])).toBe(900);
  });
  it("returns 0 for an empty array", () => {
    expect(computeEndingNetWorth([])).toBe(0);
  });
});

describe("computeYearsPortfolioSurvives", () => {
  it("returns count of years where portfolioAssets.total > 0", () => {
    const years = [year(500), year(100), year(0), year(0)];
    expect(computeYearsPortfolioSurvives(years)).toBe(2);
  });
  it("returns the full length when portfolio never hits zero", () => {
    expect(computeYearsPortfolioSurvives([year(100), year(200)])).toBe(2);
  });
});

describe("computeEstateTotals", () => {
  it("sums first + second death tax + admin from the result", () => {
    const result = {
      firstDeathEvent: { federalEstateTax: 100, stateEstateTax: 50, estateAdminExpenses: 25 },
      secondDeathEvent: { federalEstateTax: 200, stateEstateTax: 100, estateAdminExpenses: 50 },
    } as unknown as ProjectionResult;
    const totals = computeEstateTotals(result);
    expect(totals.totalEstateTax).toBe(450); // 100+50+200+100
    expect(totals.totalAdminExpenses).toBe(75);
  });

  it("handles missing death events as zero", () => {
    const totals = computeEstateTotals({} as ProjectionResult);
    expect(totals.totalEstateTax).toBe(0);
    expect(totals.totalAdminExpenses).toBe(0);
  });
});
