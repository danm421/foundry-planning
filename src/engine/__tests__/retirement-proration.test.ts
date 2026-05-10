import { describe, it, expect } from "vitest";
import { computeIncome } from "../income";
import { computeExpenses } from "../expenses";
import { applySavingsRules } from "../savings";
import {
  itemProrationGate,
  startProrationFactor,
  endInclusionAndFactor,
} from "../retirement-proration";
import type { ClientInfo, Income, Expense, SavingsRule } from "../types";

// baseClient: born 1970-01-01, retires at 65 → retirement year 2035.
const baseClient: ClientInfo = {
  firstName: "Test",
  lastName: "Client",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  retirementMonth: 7, // July → 6/12 pre-retirement, 6/12 post-retirement
  planEndAge: 95,
  filingStatus: "single",
};

const januaryClient: ClientInfo = { ...baseClient, retirementMonth: 1 };
const julyClient: ClientInfo = { ...baseClient, retirementMonth: 7 };
const decemberClient: ClientInfo = { ...baseClient, retirementMonth: 12 };

const RETIREMENT_YEAR = 2035; // 1970 + 65

describe("startProrationFactor", () => {
  it("returns 1 when ref is null/undefined", () => {
    expect(startProrationFactor(null, RETIREMENT_YEAR, julyClient)).toBe(1);
    expect(startProrationFactor(undefined, RETIREMENT_YEAR, julyClient)).toBe(1);
  });

  it("returns 1 outside the retirement year", () => {
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR - 1, julyClient)).toBe(1);
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR + 1, julyClient)).toBe(1);
  });

  it("returns 1 in the retirement year when month=1 (legacy semantics)", () => {
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR, januaryClient)).toBe(1);
  });

  it("returns (13 - month)/12 in retirement year for month > 1", () => {
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR, julyClient)).toBeCloseTo(6 / 12);
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR, decemberClient)).toBeCloseTo(1 / 12);
  });

  it("returns 1 for non-retirement refs", () => {
    expect(startProrationFactor("plan_start", RETIREMENT_YEAR, julyClient)).toBe(1);
  });
});

describe("endInclusionAndFactor", () => {
  it("normal years pre-retirement are included with factor=1", () => {
    const r = endInclusionAndFactor("client_retirement", RETIREMENT_YEAR - 1, RETIREMENT_YEAR - 1, julyClient);
    expect(r).toEqual({ included: true, factor: 1 });
  });

  it("month=1 in retirement year is excluded (legacy: full prior year, then off)", () => {
    const r = endInclusionAndFactor("client_retirement", RETIREMENT_YEAR, RETIREMENT_YEAR - 1, januaryClient);
    expect(r).toEqual({ included: false, factor: 0 });
  });

  it("month>1 in retirement year is included with (month-1)/12 factor", () => {
    const r = endInclusionAndFactor("client_retirement", RETIREMENT_YEAR, RETIREMENT_YEAR - 1, julyClient);
    expect(r.included).toBe(true);
    expect(r.factor).toBeCloseTo(6 / 12);
  });

  it("years past retirement are excluded entirely", () => {
    const r = endInclusionAndFactor("client_retirement", RETIREMENT_YEAR + 1, RETIREMENT_YEAR - 1, julyClient);
    expect(r).toEqual({ included: false, factor: 0 });
  });

  it("non-retirement refs follow standard endYear inclusion (no extension)", () => {
    expect(endInclusionAndFactor("plan_end", RETIREMENT_YEAR, RETIREMENT_YEAR - 1, julyClient))
      .toEqual({ included: false, factor: 0 });
    expect(endInclusionAndFactor("plan_end", RETIREMENT_YEAR - 1, RETIREMENT_YEAR - 1, julyClient))
      .toEqual({ included: true, factor: 1 });
  });
});

describe("itemProrationGate — combined", () => {
  const endItem = { startYear: 2020, endYear: RETIREMENT_YEAR - 1, endYearRef: "client_retirement" };
  const startItem = { startYear: RETIREMENT_YEAR, endYear: 2055, startYearRef: "client_retirement" };

  it("end-at-retirement item: full year before, partial in retYear (month>1)", () => {
    expect(itemProrationGate(endItem, RETIREMENT_YEAR - 1, julyClient).factor).toBe(1);
    const inRetYear = itemProrationGate(endItem, RETIREMENT_YEAR, julyClient);
    expect(inRetYear.include).toBe(true);
    expect(inRetYear.factor).toBeCloseTo(6 / 12);
  });

  it("start-at-retirement item: partial in retYear, full year after (month>1)", () => {
    const inRetYear = itemProrationGate(startItem, RETIREMENT_YEAR, julyClient);
    expect(inRetYear.include).toBe(true);
    expect(inRetYear.factor).toBeCloseTo(6 / 12);
    expect(itemProrationGate(startItem, RETIREMENT_YEAR + 1, julyClient).factor).toBe(1);
  });

  it("month=1: end-item excluded in retYear, start-item full in retYear", () => {
    expect(itemProrationGate(endItem, RETIREMENT_YEAR, januaryClient).include).toBe(false);
    expect(itemProrationGate(startItem, RETIREMENT_YEAR, januaryClient).factor).toBe(1);
  });
});

describe("computeIncome — retirement-month proration", () => {
  const salary: Income = {
    id: "salary",
    type: "salary",
    name: "Salary",
    annualAmount: 120_000,
    startYear: 2020,
    endYear: RETIREMENT_YEAR - 1, // resolved as retirementYear - 1
    growthRate: 0,
    owner: "client",
    endYearRef: "client_retirement",
  };

  const deferredComp: Income = {
    id: "deferred",
    type: "deferred",
    name: "Deferred Comp",
    annualAmount: 60_000,
    startYear: RETIREMENT_YEAR,
    endYear: 2050,
    growthRate: 0,
    owner: "client",
    startYearRef: "client_retirement",
  };

  it("month=1 keeps legacy behavior: salary stops the year before, full deferred starting at retYear", () => {
    expect(computeIncome([salary], RETIREMENT_YEAR - 1, januaryClient).salaries).toBe(120_000);
    expect(computeIncome([salary], RETIREMENT_YEAR, januaryClient).salaries).toBe(0);
    expect(computeIncome([deferredComp], RETIREMENT_YEAR, januaryClient).deferred).toBe(60_000);
  });

  it("month=7 prorates salary (6/12 in retYear) and deferred (6/12 in retYear)", () => {
    expect(computeIncome([salary], RETIREMENT_YEAR - 1, julyClient).salaries).toBe(120_000);
    expect(computeIncome([salary], RETIREMENT_YEAR, julyClient).salaries).toBeCloseTo(60_000);
    expect(computeIncome([salary], RETIREMENT_YEAR + 1, julyClient).salaries).toBe(0);
    expect(computeIncome([deferredComp], RETIREMENT_YEAR, julyClient).deferred).toBeCloseTo(30_000);
    expect(computeIncome([deferredComp], RETIREMENT_YEAR + 1, julyClient).deferred).toBe(60_000);
  });

  it("month=12 prorates salary to 11/12 and deferred to 1/12 in retYear", () => {
    expect(computeIncome([salary], RETIREMENT_YEAR, decemberClient).salaries).toBeCloseTo(110_000);
    expect(computeIncome([deferredComp], RETIREMENT_YEAR, decemberClient).deferred).toBeCloseTo(5_000);
  });

  it("non-retirement-linked income is not prorated", () => {
    const otherIncome: Income = {
      id: "other",
      type: "other",
      name: "Other",
      annualAmount: 10_000,
      startYear: 2020,
      endYear: 2050,
      growthRate: 0,
      owner: "client",
      endYearRef: "plan_end",
    };
    expect(computeIncome([otherIncome], RETIREMENT_YEAR, julyClient).other).toBe(10_000);
  });
});

describe("computeExpenses — retirement-month proration", () => {
  const preRetExpense: Expense = {
    id: "preRet",
    type: "living",
    name: "Pre-retirement living",
    annualAmount: 100_000,
    startYear: 2020,
    endYear: RETIREMENT_YEAR - 1,
    growthRate: 0,
    endYearRef: "client_retirement",
  };

  const postRetExpense: Expense = {
    id: "postRet",
    type: "living",
    name: "Retirement living",
    annualAmount: 80_000,
    startYear: RETIREMENT_YEAR,
    endYear: 2055,
    growthRate: 0,
    startYearRef: "client_retirement",
  };

  it("month=7 prorates both halves of the transition", () => {
    expect(computeExpenses([preRetExpense], RETIREMENT_YEAR, julyClient).living).toBeCloseTo(50_000);
    expect(computeExpenses([postRetExpense], RETIREMENT_YEAR, julyClient).living).toBeCloseTo(40_000);
  });

  it("totals at the transition: pre + post equals one year's worth (with adjusted spend)", () => {
    // 6/12 × $100k + 6/12 × $80k = $50k + $40k = $90k
    const all = computeExpenses([preRetExpense, postRetExpense], RETIREMENT_YEAR, julyClient);
    expect(all.living).toBeCloseTo(90_000);
  });

  it("month=1 keeps the discrete handoff: full pre-ret expense in year before, full post in retYear", () => {
    expect(computeExpenses([preRetExpense], RETIREMENT_YEAR - 1, januaryClient).living).toBe(100_000);
    expect(computeExpenses([preRetExpense], RETIREMENT_YEAR, januaryClient).living).toBe(0);
    expect(computeExpenses([postRetExpense], RETIREMENT_YEAR, januaryClient).living).toBe(80_000);
  });
});

describe("applySavingsRules — retirement-month proration", () => {
  const preRetRule: SavingsRule = {
    id: "preRet",
    accountId: "acct-401k",
    annualAmount: 23_500,
    isDeductible: true,
    startYear: 2020,
    endYear: RETIREMENT_YEAR - 1,
    endYearRef: "client_retirement",
  };

  it("month=7 prorates flat-amount savings to 6/12 in retYear", () => {
    expect(applySavingsRules([preRetRule], RETIREMENT_YEAR, 0, julyClient).total).toBeCloseTo(23_500 / 2);
  });

  it("month=1 excludes the rule entirely from retYear", () => {
    expect(applySavingsRules([preRetRule], RETIREMENT_YEAR, 0, januaryClient).total).toBe(0);
  });
});

describe("spouse retirement month", () => {
  const dualClient: ClientInfo = {
    ...julyClient,
    spouseDob: "1972-01-01",
    spouseRetirementAge: 67,    // → 2039
    spouseRetirementMonth: 4,   // April → 3/12 pre-ret, 9/12 post-ret
  };

  it("spouse_retirement uses spouseRetirementMonth, not retirementMonth", () => {
    // In the spouse's retirement year (2039), spouse-linked items prorate by 3/12.
    expect(startProrationFactor("spouse_retirement", 2039, dualClient)).toBeCloseTo(9 / 12);
    const r = endInclusionAndFactor("spouse_retirement", 2039, 2038, dualClient);
    expect(r.included).toBe(true);
    expect(r.factor).toBeCloseTo(3 / 12);
  });

  it("client_retirement and spouse_retirement do not interfere", () => {
    // 2035 is client retYear; spouse-linked refs see normal year, not retirement.
    expect(startProrationFactor("spouse_retirement", 2035, dualClient)).toBe(1);
    // 2039 is spouse retYear; client-linked refs see normal year, not retirement.
    expect(startProrationFactor("client_retirement", 2039, dualClient)).toBe(1);
  });
});

describe("month value clamping", () => {
  it("clamps retirementMonth < 1 to 1", () => {
    const c: ClientInfo = { ...baseClient, retirementMonth: 0 };
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR, c)).toBe(1);
  });

  it("clamps retirementMonth > 12 to 12", () => {
    const c: ClientInfo = { ...baseClient, retirementMonth: 99 };
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR, c)).toBeCloseTo(1 / 12);
  });

  it("treats undefined retirementMonth as 1 (legacy)", () => {
    const c: ClientInfo = { ...baseClient };
    delete (c as Partial<ClientInfo>).retirementMonth;
    expect(startProrationFactor("client_retirement", RETIREMENT_YEAR, c)).toBe(1);
  });
});
