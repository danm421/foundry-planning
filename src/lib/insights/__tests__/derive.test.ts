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
    // Capacity's two clocks are measured from retirement, not from plan end.
    expect(capacity.yearsToRetirement).toBe(5); // 65 - 60
    expect(capacity.retirementYears).toBe(25); // 90 - 65
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

  it("counts Social Security that starts AFTER the retirement year", () => {
    // Retire at 65, claim SS at 67 -- the overwhelmingly common shape. The
    // engine gates SS to the claiming age, so the first two retirement years
    // carry none. Sampling only retYears[0] read 0 for these households even
    // when the plan held a six-figure benefit.
    const projection = [
      yr({ age: 65, incomeTotal: 0, ss: 0, deferred: 0, expensesTotal: 90_000, liquidTotal: 1_100_000 }),
      yr({ age: 66, incomeTotal: 0, ss: 0, deferred: 0, expensesTotal: 90_000, liquidTotal: 1_050_000 }),
      yr({ age: 67, incomeTotal: 40_000, ss: 40_000, deferred: 0, expensesTotal: 90_000, liquidTotal: 1_000_000 }),
      yr({ age: 68, incomeTotal: 40_000, ss: 40_000, deferred: 0, expensesTotal: 90_000, liquidTotal: 950_000 }),
    ];
    const { capacity } = deriveInsightInputs({
      projection, currentAge: 65, retirementAge: 65, planEndAge: 90,
      fundingScore: 1.0, cashReturn: 0.02, equityReturn: 0.07,
    });
    // Measured over the years the floor is actually flowing: 80k / 180k.
    expect(capacity.guaranteedIncomeCoverage).toBeCloseTo(40_000 / 90_000, 3);
  });

  it("is not distorted by a single low-expense year", () => {
    // Aggregate ratio, not a mean of per-year ratios -- one year with a
    // collapsed expense base must not manufacture a full income floor.
    const projection = [
      yr({ age: 65, incomeTotal: 40_000, ss: 40_000, deferred: 0, expensesTotal: 1_000, liquidTotal: 1_000_000 }),
      yr({ age: 66, incomeTotal: 40_000, ss: 40_000, deferred: 0, expensesTotal: 200_000, liquidTotal: 950_000 }),
    ];
    const { capacity } = deriveInsightInputs({
      projection, currentAge: 65, retirementAge: 65, planEndAge: 90,
      fundingScore: 1.0, cashReturn: 0.02, equityReturn: 0.07,
    });
    expect(capacity.guaranteedIncomeCoverage).toBeCloseTo(80_000 / 201_000, 3);
  });

  it("reports a zero floor when the plan holds no guaranteed income", () => {
    const projection = [
      yr({ age: 65, incomeTotal: 0, ss: 0, deferred: 0, expensesTotal: 90_000, liquidTotal: 1_000_000 }),
      yr({ age: 66, incomeTotal: 0, ss: 0, deferred: 0, expensesTotal: 90_000, liquidTotal: 950_000 }),
    ];
    const { capacity } = deriveInsightInputs({
      projection, currentAge: 65, retirementAge: 65, planEndAge: 90,
      fundingScore: 1.0, cashReturn: 0.02, equityReturn: 0.07,
    });
    expect(capacity.guaranteedIncomeCoverage).toBe(0);
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
