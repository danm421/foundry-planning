import { describe, it, expect } from "vitest";
import type { SolverMutation } from "@/lib/solver/types";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { describeSolverMutation, mutationNames } from "../describe-solver-mutation";

const source = buildClientData();
const names = mutationNames(source, source);
const line = (m: SolverMutation) => describeSolverMutation(m, names);

describe("describeSolverMutation", () => {
  // The published solver-save-scenario help video caught "Expense (094c6461…)".
  it("names a row by its name, never its id", () => {
    expect(
      line({ kind: "expense-annual-amount", expenseId: "exp-living", annualAmount: 125000 }),
    ).toBe("Expense: Living Expenses → $125,000/yr");
    expect(
      line({ kind: "income-annual-amount", incomeId: "inc-salary-john", annualAmount: 150000 }),
    ).toBe("Income: John Salary → $150,000/yr");
    expect(
      line({ kind: "savings-contribution", accountId: "acct-401k", annualAmount: 23500 }),
    ).toBe("Savings: John 401(k) → $23,500/yr");
  });

  it("names a person by first name, not the stored client/spouse enum", () => {
    expect(line({ kind: "retirement-age", person: "client", age: 67 })).toBe(
      "Retirement age (John) → 67",
    );
    expect(line({ kind: "ss-claim-age", person: "spouse", age: 70 })).toBe("SS claim age (Jane) → 70");
  });

  it("still names a row the working copy has removed", () => {
    const working = { ...source, expenses: [], savingsRules: [] };
    const removedNames = mutationNames(source, working);
    expect(
      describeSolverMutation({ kind: "expense-upsert", id: "exp-living", value: null }, removedNames),
    ).toBe("Removed an expense: Living Expenses");
    // A savings rule has no name of its own — it reads as the account it funds.
    expect(
      describeSolverMutation({ kind: "savings-rule-upsert", id: "sav-401k", value: null }, removedNames),
    ).toBe("Removed a savings contribution: John 401(k)");
  });

  it("titles a stress test the way the saved scenario's Changes tab does", () => {
    expect(line({ kind: "stress-market-crash", year: 2030, drawdownPct: 0.3 })).toBe(
      "Market crash — 30% in 2030",
    );
  });

  it("reads a kind that used to print as its raw code", () => {
    expect(line({ kind: "ss-cola", person: "client", rate: 0.025 })).toBe(
      "SS cost-of-living raise (John) → 2.5% a year",
    );
    expect(
      line({
        kind: "savings-employer-match-pct",
        accountId: "acct-401k",
        pct: 0.5,
        cap: 0.06,
      }),
    ).toBe("Savings: John 401(k) → employer match 50% on 6% of salary");
  });

  it("falls back to the noun alone for a row neither plan knows", () => {
    expect(
      line({ kind: "income-end-year", incomeId: "not-a-row", year: 2040 }),
    ).toBe("Income ends 2040");
  });
});
