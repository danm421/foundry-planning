import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { growthPctFromAllocation, deriveInsightInputs } from "../derive";

// Minimal ProjectionYear factory — only the fields derive.ts reads.
const yr = (o: {
  age: number;
  incomeTotal: number;
  ss: number;
  deferred: number;
  expensesTotal: number;
  liquidTotal: number;
}): ProjectionYear =>
  ({
    year: 2026,
    ages: { client: o.age },
    income: {
      salaries: 0, socialSecurity: o.ss, business: 0, trust: 0, deferred: o.deferred,
      capitalGains: 0, other: 0, total: o.incomeTotal, bySource: {},
    },
    expenses: {
      living: 0, liabilities: 0, other: 0, insurance: 0, realEstate: 0, taxes: 0,
      cashGifts: 0, discretionary: 0, total: o.expensesTotal, bySource: {},
      byLiability: {}, interestByLiability: {},
    },
    totalIncome: o.incomeTotal,
    totalExpenses: o.expensesTotal,
    portfolioAssets: { liquidTotal: o.liquidTotal } as ProjectionYear["portfolioAssets"],
  }) as unknown as ProjectionYear;

describe("growthPctFromAllocation", () => {
  it("sums the equities group into a 0..100 pct", () => {
    expect(
      growthPctFromAllocation([
        { group: "equities", pct: 0.78 },
        { group: "taxable_bonds", pct: 0.15 },
        { group: "cash", pct: 0.07 },
      ]),
    ).toBe(78);
  });
  it("returns 0 for an empty rollup", () => {
    expect(growthPctFromAllocation([])).toBe(0);
  });
});

describe("deriveInsightInputs", () => {
  it("builds capacity + required inputs from a retirement projection", () => {
    const projection = [
      yr({ age: 60, incomeTotal: 200_000, ss: 0, deferred: 0, expensesTotal: 150_000, liquidTotal: 1_000_000 }),
      yr({ age: 65, incomeTotal: 40_000, ss: 30_000, deferred: 10_000, expensesTotal: 90_000, liquidTotal: 1_100_000 }),
      yr({ age: 66, incomeTotal: 40_000, ss: 30_000, deferred: 10_000, expensesTotal: 90_000, liquidTotal: 1_050_000 }),
    ];
    const { capacity, required } = deriveInsightInputs({
      projection,
      currentAge: 60,
      retirementAge: 65,
      planEndAge: 90,
      fundingScore: 1.2,
      cashReturn: 0.02,
      equityReturn: 0.07,
    });
    expect(capacity.horizonYears).toBe(30); // 90 - 60
    expect(capacity.fundingScore).toBe(1.2);
    // guaranteed income coverage at first retirement year = (30k+10k)/90k
    expect(capacity.guaranteedIncomeCoverage).toBeCloseTo(40_000 / 90_000, 3);
    // required uses retirement-year starting liquid assets
    expect(required.startingLiquidAssets).toBe(1_100_000);
    // avg real net withdrawal over retirement years = mean(max(90k-40k,0)) = 50k
    expect(required.avgAnnualRealNetWithdrawal).toBe(50_000);
    expect(required.horizonYears).toBe(25); // 90 - 65
    expect(required.cashReturn).toBe(0.02);
  });

  it("degrades safely when there are no retirement years in the projection", () => {
    const projection = [
      yr({ age: 60, incomeTotal: 200_000, ss: 0, deferred: 0, expensesTotal: 150_000, liquidTotal: 1_000_000 }),
    ];
    const { required } = deriveInsightInputs({
      projection, currentAge: 60, retirementAge: 65, planEndAge: 90,
      fundingScore: 1.0, cashReturn: 0.02, equityReturn: 0.07,
    });
    expect(required.avgAnnualRealNetWithdrawal).toBe(0);
    expect(required.startingLiquidAssets).toBeGreaterThanOrEqual(0);
  });
});
