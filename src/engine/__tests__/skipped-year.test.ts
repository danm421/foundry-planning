import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { inflationBaseYear, rebaseSkippedYearRows } from "../skipped-year";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, Income, Transfer } from "../types";

// "Start the plan next year": with planStartYear 2027 and dataYear 2026, the
// window [2026, 2027) already happened. An amount entered this year is next
// year's first-year amount; growth starts the year after.

const on = { ...basePlanSettings, planStartYear: 2027, planEndYear: 2045, dataYear: 2026 };

const salary: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Salary",
  annualAmount: 200_000,
  startYear: 2026,
  endYear: 2040,
  growthRate: 0.03,
  owner: "client",
};

const owned = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];

const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 1_000_000, basis: 1_000_000, growthRate: 0,
  rmdEnabled: false, isDefaultChecking: true, owners: owned,
};

const brokerage: Account = {
  id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false, owners: owned,
};

function transferRun(transfer: Transfer) {
  return runProjection(
    buildClientData({
      accounts: [checking, brokerage],
      incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
      transfers: [transfer],
      planSettings: on,
    }),
  );
}

describe("inflationBaseYear", () => {
  it("rebases only a base year inside the skipped year", () => {
    expect(inflationBaseYear(2026, on)).toBe(2027);
    expect(inflationBaseYear(2025, on)).toBe(2025);
    expect(inflationBaseYear(2030, on)).toBe(2030);
    expect(inflationBaseYear(2026, { ...on, dataYear: undefined })).toBe(2026);
  });
});

describe("runProjection with a skipped year", () => {
  it("a salary entered this year is next year's first-year amount", () => {
    const years = runProjection(buildClientData({ planSettings: on, incomes: [salary] }));
    expect(years[0].year).toBe(2027);
    expect(years[0].income.salaries).toBeCloseTo(200_000, 0);
    expect(years[1].income.salaries).toBeCloseTo(206_000, 0);
  });

  it("with the switch off the same salary grows into 2027 as before", () => {
    const off = { ...on, planStartYear: 2026, dataYear: 2026 };
    const years = runProjection(buildClientData({ planSettings: off, incomes: [salary] }));
    expect(years.find((y) => y.year === 2027)!.income.salaries).toBeCloseTo(206_000, 0);
  });

  it("a today's-dollars row starting later inflates from the plan start", () => {
    const later: Expense = {
      id: "exp-later", type: "other", name: "Later", annualAmount: 100_000,
      startYear: 2040, endYear: 2045, growthRate: 0.03, inflationStartYear: 2026,
    };
    const years = runProjection(buildClientData({ planSettings: on, expenses: [later] }));
    const y2040 = years.find((y) => y.year === 2040)!;
    expect(y2040.expenses.bySource["exp-later"]).toBeCloseTo(100_000 * 1.03 ** 13, 0);
  });

  it("a recurring transfer that started this year moves its entered amount in the first plan year", () => {
    const years = transferRun({
      id: "xfer", name: "Sweep", sourceAccountId: "acct-checking", targetAccountId: "acct-brokerage",
      amount: 10_000, mode: "recurring", startYear: 2026, endYear: 2040, growthRate: 0.03, schedules: [],
    });
    expect(years[0].accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(10_000, 0);
  });

  it("a one-time transfer dated this year does not run in any plan year", () => {
    const years = transferRun({
      id: "xfer", name: "Once", sourceAccountId: "acct-checking", targetAccountId: "acct-brokerage",
      amount: 10_000, mode: "one_time", startYear: 2026, growthRate: 0, schedules: [],
    });
    for (const y of years) expect(y.accountLedgers["acct-brokerage"].endingValue).toBe(0);
  });
});

describe("rebaseSkippedYearRows", () => {
  it("returns the same object when nothing is skipped", () => {
    const data = buildClientData({ planSettings: { ...on, dataYear: 2027 }, incomes: [salary] });
    expect(rebaseSkippedYearRows(data)).toBe(data);
  });

  it("never mutates the caller's rows", () => {
    const data = buildClientData({ planSettings: on, incomes: [salary] });
    rebaseSkippedYearRows(data);
    expect(data.incomes[0].inflationStartYear).toBeUndefined();
  });
});
