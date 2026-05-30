import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { deriveRetirementSummary } from "../derive-retirement-summary";

// Minimal ProjectionYear factory — only the fields deriveRetirementSummary reads.
function yr(opts: {
  year: number;
  client: number;
  spouse?: number;
  liquid: number;        // liquidPortfolioTotal = taxable+cash+retirement
  income: number;        // income.total
  withdrawals: number;   // withdrawals.total
  expenses: number;      // totalExpenses
}): ProjectionYear {
  return {
    year: opts.year,
    ages: { client: opts.client, spouse: opts.spouse },
    income: { total: opts.income } as ProjectionYear["income"],
    withdrawals: { total: opts.withdrawals, byAccount: {} },
    totalIncome: opts.income,
    totalExpenses: opts.expenses,
    netCashFlow: opts.income - opts.expenses,
    portfolioAssets: {
      taxableTotal: opts.liquid,
      cashTotal: 0,
      retirementTotal: 0,
    } as ProjectionYear["portfolioAssets"],
  } as ProjectionYear;
}

describe("deriveRetirementSummary", () => {
  it("reports runs-short metrics when liquid goes negative", () => {
    const years = [
      yr({ year: 2040, client: 65, spouse: 61, liquid: 100, income: 80, withdrawals: 20, expenses: 100 }),
      yr({ year: 2041, client: 66, spouse: 62, liquid: 50, income: 80, withdrawals: 20, expenses: 100 }),
      yr({ year: 2042, client: 67, spouse: 63, liquid: -30, income: 40, withdrawals: 10, expenses: 100 }),
      yr({ year: 2043, client: 68, spouse: 64, liquid: -130, income: 40, withdrawals: 0, expenses: 100 }),
    ];
    const s = deriveRetirementSummary(years);
    expect(s.fullyFunded).toBe(false);
    expect(s.assetsRemaining).toBe(-130);
    expect(s.ageAssetsLastUntil).toEqual({ client: 66, spouse: 62 }); // last year liquid >= 0
    expect(s.yearsFullyFunded).toBe(2);                                // 2040, 2041
    // partial years 2042 (50%) and 2043 (40%) -> mean 0.45
    expect(s.avgPercentFunded).toBeCloseTo(0.45, 5);
  });

  it("reports fully-funded when liquid never goes negative", () => {
    const years = [
      yr({ year: 2040, client: 65, liquid: 100, income: 80, withdrawals: 20, expenses: 100 }),
      yr({ year: 2041, client: 66, liquid: 120, income: 130, withdrawals: 0, expenses: 100 }),
    ];
    const s = deriveRetirementSummary(years);
    expect(s.fullyFunded).toBe(true);
    expect(s.assetsRemaining).toBe(120);
    expect(s.ageAssetsLastUntil).toBeNull();
    expect(s.yearsFullyFunded).toBe(2);
    expect(s.avgPercentFunded).toBeNull();
  });

  it("omits spouse age for single-client plans", () => {
    const years = [
      yr({ year: 2040, client: 70, liquid: 10, income: 50, withdrawals: 50, expenses: 100 }),
      yr({ year: 2041, client: 71, liquid: -5, income: 50, withdrawals: 0, expenses: 100 }),
    ];
    const s = deriveRetirementSummary(years);
    expect(s.ageAssetsLastUntil).toEqual({ client: 70, spouse: null });
  });
});
