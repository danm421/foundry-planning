import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { baseClient, basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";

// The prior-Dec-31 balance (`priorYearEndValue`) is the right RMD basis for the
// first plan year only when the plan starts in the year the data describes.
// Starting next year, the entered `value` IS the Dec-31 balance before the
// first plan year: 2026's RMD is already out of it.

const AGE_75_DIVISOR = 24.6;

function firstYearRmd(planStartYear: number, dataYear: number): number {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: "1952-01-01" }, // age 75 in 2027
    accounts: [
      {
        id: "acct-ira",
        name: "Traditional IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 1_000_000,
        basis: 0,
        growthRate: 0,
        rmdEnabled: true,
        priorYearEndValue: 900_000,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear, planEndYear: 2030, dataYear },
  });
  const y = runProjection(data)[0];
  expect(y.year).toBe(planStartYear);
  return y.accountLedgers["acct-ira"].rmdAmount;
}

describe("first-year RMD when the plan starts next year", () => {
  it("reads the entered balance, not last year's Dec-31 balance", () => {
    expect(firstYearRmd(2027, 2026)).toBeCloseTo(1_000_000 / AGE_75_DIVISOR, 0);
  });

  it("keeps the prior-year balance when the plan starts in the data year", () => {
    expect(firstYearRmd(2027, 2027)).toBeCloseTo(900_000 / AGE_75_DIVISOR, 0);
  });
});
