import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, baseClient, basePlanSettings } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Income, Expense, SavingsRule, FamilyMember, WithdrawalPriority } from "../types";

// End-to-end smoke test for retirement-month proration. The unit tests in
// retirement-proration.test.ts cover individual call sites; this one runs
// the full runProjection pipeline so wiring drift across the duplicate
// item-scan loops in projection.ts shows up here.
//
// Setup: client born 1970, retires at 65 → retirementYear 2035, retirementMonth 7.
//   - Salary $120k flat, ends at retirement (endYearRef = client_retirement)
//   - Retirement-living expense $60k flat, starts at retirement (startYearRef = ...)
//   - 401(k) savings rule $10k flat, ends at retirement (endYearRef = client_retirement)
//
// In retirement year 2035 (6/12 prorated):
//   salaries     ≈ $60k     (6/12 of $120k)
//   living       ≈ $30k     (6/12 of $60k)
//   401k contrib ≈ $5k      (6/12 of $10k)
// In post-retirement 2036:
//   salaries  = 0   ·   living = $60k   ·   401k = 0

const RETIREMENT_YEAR = 2035; // 1970 + 65

const checking: Account = {
  id: "acct-checking",
  name: "Checking",
  category: "cash",
  subType: "checking",
  value: 200_000,
  basis: 200_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const retirement401k: Account = {
  id: "acct-401k",
  name: "Solo 401(k)",
  category: "retirement",
  subType: "401k",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const salary: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Salary",
  annualAmount: 120_000,
  startYear: 2026,
  endYear: RETIREMENT_YEAR - 1, // 2034 — milestone-resolved end of pre-retirement window
  growthRate: 0,
  owner: "client",
  endYearRef: "client_retirement",
};

const retirementLiving: Expense = {
  id: "exp-ret-living",
  type: "living",
  name: "Retirement Living",
  annualAmount: 60_000,
  startYear: RETIREMENT_YEAR,
  endYear: 2055,
  growthRate: 0,
  startYearRef: "client_retirement",
};

const savings401k: SavingsRule = {
  id: "sav-401k",
  accountId: "acct-401k",
  annualAmount: 10_000,
  isDeductible: true,
  startYear: 2026,
  endYear: RETIREMENT_YEAR - 1,
  endYearRef: "client_retirement",
};

const soloFamily: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
  },
];

const withdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-checking", priorityOrder: 1, startYear: 2026, endYear: 2055 },
  { accountId: "acct-401k", priorityOrder: 2, startYear: 2026, endYear: 2055 },
];

describe("retirement-month proration — runProjection end-to-end", () => {
  it("prorates salary, expense, and 401k contribution in the retirement year (month 7)", () => {
    const data = buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        retirementMonth: 7,
        // Single household to keep the assertions about household totals
        // simple — drop the spouse fields from baseClient.
        spouseName: undefined,
        spouseDob: undefined,
        spouseRetirementAge: undefined,
      },
      familyMembers: soloFamily,
      accounts: [checking, retirement401k],
      incomes: [salary],
      expenses: [retirementLiving],
      liabilities: [],
      savingsRules: [savings401k],
      withdrawalStrategy,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2036 },
    });
    const years = runProjection(data);
    const retYear = years.find((y) => y.year === RETIREMENT_YEAR);
    const postRetYear = years.find((y) => y.year === RETIREMENT_YEAR + 1);
    expect(retYear).toBeDefined();
    expect(postRetYear).toBeDefined();

    // Retirement year (2035) — 6/12 of each retirement-linked item.
    expect(retYear!.income.salaries).toBeCloseTo(60_000, 0);
    expect(retYear!.expenses.bySource["exp-ret-living"]).toBeCloseTo(30_000, 0);
    expect(retYear!.savings.byAccount["acct-401k"]).toBeCloseTo(5_000, 0);

    // Post-retirement (2036) — salary and 401k contribution are gone, full
    // year of retirement-living expense.
    expect(postRetYear!.income.salaries).toBe(0);
    expect(postRetYear!.savings.byAccount["acct-401k"] ?? 0).toBe(0);
    expect(postRetYear!.expenses.bySource["exp-ret-living"]).toBeCloseTo(60_000, 0);
  });
});
