import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { fundingScore } from "../retirement-funding-score";

function yr(year: number, liquid: number): ProjectionYear {
  return {
    year,
    ages: { client: 65 },
    income: { total: 0 } as ProjectionYear["income"],
    withdrawals: { total: 0, byAccount: {} },
    totalIncome: 0,
    totalExpenses: 100,
    netCashFlow: -100,
    portfolioAssets: {
      taxableTotal: liquid,
      cashTotal: 0,
      retirementTotal: 0,
    } as ProjectionYear["portfolioAssets"],
  } as ProjectionYear;
}

describe("fundingScore", () => {
  it("returns >= 1 when liquid never goes negative", () => {
    expect(fundingScore([yr(2040, 100), yr(2041, 50)])).toBeGreaterThanOrEqual(1);
  });

  it("returns < 1 and is monotonic in the worst (most negative) year", () => {
    const mild = fundingScore([yr(2040, 100), yr(2041, -50)]);
    const severe = fundingScore([yr(2040, 100), yr(2041, -500)]);
    expect(mild).toBeLessThan(1);
    expect(severe).toBeLessThan(mild); // worse shortfall scores lower
  });

  it("returns 0 for an empty projection", () => {
    expect(fundingScore([])).toBe(0);
  });

  it("treats exactly-zero liquid as fully funded (boundary the bisect relies on)", () => {
    expect(fundingScore([yr(2040, 0), yr(2041, 0)])).toBe(1);
  });
});
