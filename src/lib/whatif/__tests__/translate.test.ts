// src/lib/whatif/__tests__/translate.test.ts
import { describe, it, expect, vi } from "vitest";
import { translateChanges } from "../translate";
import { WhatIfValidationError } from "../errors";
import type { WhatIfChange } from "../changes";
import { IDS, whatIfTree } from "./fixtures";

// The translator stays framework-free all the way down: anything in its
// import graph that loads Next or the database fails this suite at import.
vi.mock("next/server", () => {
  throw new Error("src/lib/whatif must not import next/server, even transitively");
});
vi.mock("@/db", () => {
  throw new Error("src/lib/whatif must not import @/db, even transitively");
});

const run = (changes: WhatIfChange[]) => translateChanges(whatIfTree(), changes, () => "00000000-0000-4000-8000-0000000000aa");

describe("translateChanges — simple levers", () => {
  it("maps a retirement age 1:1", () => {
    expect(run([{ type: "retirement_age", person: "client", age: 62 }])).toEqual({
      mutations: [{ kind: "retirement-age", person: "client", age: 62 }],
      recordIds: [null],
    });
  });

  it("refuses the spouse in a household without one", () => {
    const tree = whatIfTree();
    tree.client = { ...tree.client, spouseName: undefined, spouseDob: undefined };
    tree.familyMembers = (tree.familyMembers ?? []).filter((f) => f.role !== "spouse");
    expect(() =>
      translateChanges(tree, [{ type: "retirement_age", person: "spouse", age: 62 }]),
    ).toThrow("Change 1: this household has no spouse.");
  });

  it("maps a spending scale and a spending amount", () => {
    expect(run([{ type: "spending_scale", multiplier: 0.9 }]).mutations).toEqual([
      { kind: "living-expense-scale", multiplier: 0.9 },
    ]);
    expect(run([{ type: "spending_amount", annualAmount: 150_000 }]).mutations).toEqual([
      { kind: "living-expense-amount", amount: 150_000 },
    ]);
  });

  it("refuses an expense id from another household, before anything runs", () => {
    expect(() => run([{ type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 }])).toThrow(
      WhatIfValidationError,
    );
    expect(() => run([{ type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 }])).toThrow(
      /Change 1: expense .* isn't in this plan/,
    );
  });

  it("refuses income_amount on a Social Security row", () => {
    expect(() => run([{ type: "income_amount", incomeId: IDS.ssJohn, annualAmount: 1 }])).toThrow(
      /use ss_pia, ss_annual_benefit or ss_no_benefit/,
    );
  });

  it("moves an income's years and keeps start before end", () => {
    expect(run([{ type: "income_years", incomeId: IDS.salaryJohn, endYear: 2030 }]).mutations).toEqual([
      { kind: "income-end-year", incomeId: IDS.salaryJohn, year: 2030 },
    ]);
    expect(() => run([{ type: "income_years", incomeId: IDS.salaryJohn }])).toThrow(/give startYear, endYear or both/);
    expect(() =>
      run([{ type: "income_years", incomeId: IDS.salaryJohn, startYear: 2040, endYear: 2030 }]),
    ).toThrow(/is after endYear/);
  });

  it("refuses a year outside the plan", () => {
    expect(() => run([{ type: "income_years", incomeId: IDS.salaryJohn, endYear: 2099 }])).toThrow(
      /outside the plan \(2026–2055\)/,
    );
  });

  it("sets the claim-age mode to years before the claim age, so the age takes effect", () => {
    expect(run([{ type: "ss_claim_age", person: "client", age: 70 }]).mutations).toEqual([
      { kind: "ss-claim-age-mode", person: "client", mode: "years" },
      { kind: "ss-claim-age", person: "client", age: 70 },
    ]);
  });

  it("refuses a Social Security change for someone with no Social Security row", () => {
    expect(() => run([{ type: "ss_claim_age", person: "spouse", age: 67 }])).toThrow(
      /no Social Security income for the spouse/,
    );
  });

  it("switches the benefit mode with each benefit change", () => {
    expect(run([{ type: "ss_pia", person: "client", piaMonthly: 3200 }]).mutations).toEqual([
      { kind: "ss-benefit-mode", person: "client", mode: "pia_at_fra" },
      { kind: "ss-pia-monthly", person: "client", amount: 3200 },
    ]);
    expect(run([{ type: "ss_no_benefit", person: "client" }]).mutations).toEqual([
      { kind: "ss-benefit-mode", person: "client", mode: "no_benefit" },
    ]);
  });

  it("clears percent-of-salary before setting a dollar contribution", () => {
    expect(run([{ type: "savings_amount", accountId: IDS.k401, annualAmount: 23_500 }]).mutations).toEqual([
      { kind: "savings-annual-percent", accountId: IDS.k401, percent: null },
      { kind: "savings-contribution", accountId: IDS.k401, annualAmount: 23_500 },
    ]);
  });

  it("refuses a savings change on an account with no savings rule", () => {
    expect(() => run([{ type: "savings_amount", accountId: IDS.brokerage, annualAmount: 1 }])).toThrow(
      /has no savings rule/,
    );
  });

  it("maps stress tests and defaults a disability's end to open-ended", () => {
    expect(run([{ type: "stress_disability", person: "client", startYear: 2028 }]).mutations).toEqual([
      { kind: "stress-disability", person: "client", startYear: 2028, endYear: null },
    ]);
    expect(run([{ type: "stress_market_crash", year: 2027, drawdownPct: 0.3 }]).mutations).toEqual([
      { kind: "stress-market-crash", year: 2027, drawdownPct: 0.3 },
    ]);
  });

  it("numbers the failing change by its position", () => {
    expect(() =>
      run([
        { type: "spending_scale", multiplier: 0.9 },
        { type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 },
      ]),
    ).toThrow(/^Change 2: /);
  });

  it("keeps recordIds aligned with the input", () => {
    const out = run([
      { type: "spending_scale", multiplier: 0.9 },
      { type: "income_amount", incomeId: IDS.salaryJane, annualAmount: 90_000 },
    ]);
    expect(out.recordIds).toEqual([null, IDS.salaryJane]);
  });
});
