// src/lib/analysis/__tests__/mutations-to-base-updates.test.ts
import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { mutationsToBaseUpdates } from "../mutations-to-base-updates";

// Minimal ClientData fixture: one earned-income row, one SS income row,
// one expense, one savings rule + the account it points at. Only the fields
// the helper reads are populated; the rest are stubbed to satisfy the type.
function makeTree(): ClientData {
  return {
    client: {} as never,
    accounts: [{ id: "acct-1" } as never],
    incomes: [
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        annualAmount: 100_000,
        startYear: 2026,
        endYear: 2040,
        growthRate: 0.03,
        owner: "client",
      } as never,
      {
        id: "ss-client",
        type: "social_security",
        name: "Social Security",
        annualAmount: 30_000,
        startYear: 2040,
        endYear: 2060,
        growthRate: 0.02,
        owner: "client",
      } as never,
    ],
    expenses: [
      {
        id: "exp-1",
        type: "living",
        name: "Living",
        annualAmount: 60_000,
        startYear: 2026,
        endYear: 2060,
      } as never,
    ],
    savingsRules: [
      {
        id: "rule-1",
        accountId: "acct-1",
        annualAmount: 19_500,
        startYear: 2026,
        endYear: 2040,
      } as never,
    ],
  } as unknown as ClientData;
}

describe("mutationsToBaseUpdates", () => {
  it("maps income-annual-amount to incomes.annualAmount by income id", () => {
    const tree = makeTree();
    const { updates, skipped } = mutationsToBaseUpdates(tree, [
      { kind: "income-annual-amount", incomeId: "inc-1", annualAmount: 120_000 },
    ]);
    expect(skipped).toEqual([]);
    expect(updates).toEqual([
      { table: "incomes", id: "inc-1", field: "annualAmount", value: 120_000 },
    ]);
  });

  it("maps income-end-year to incomes.endYear by income id", () => {
    const tree = makeTree();
    const { updates } = mutationsToBaseUpdates(tree, [
      { kind: "income-end-year", incomeId: "inc-1", year: 2045 },
    ]);
    expect(updates).toEqual([
      { table: "incomes", id: "inc-1", field: "endYear", value: 2045 },
    ]);
  });

  it("maps ss-annual-amount to the SS income row resolved by person", () => {
    const tree = makeTree();
    const { updates } = mutationsToBaseUpdates(tree, [
      { kind: "ss-annual-amount", person: "client", amount: 35_000 },
    ]);
    expect(updates).toEqual([
      { table: "incomes", id: "ss-client", field: "annualAmount", value: 35_000 },
    ]);
  });

  it("maps expense-annual-amount to expenses.annualAmount by expense id", () => {
    const tree = makeTree();
    const { updates } = mutationsToBaseUpdates(tree, [
      { kind: "expense-annual-amount", expenseId: "exp-1", annualAmount: 72_000 },
    ]);
    expect(updates).toEqual([
      { table: "expenses", id: "exp-1", field: "annualAmount", value: 72_000 },
    ]);
  });

  it("maps savings-contribution to the rule resolved by accountId, by rule id", () => {
    const tree = makeTree();
    const { updates } = mutationsToBaseUpdates(tree, [
      { kind: "savings-contribution", accountId: "acct-1", annualAmount: 23_000 },
    ]);
    expect(updates).toEqual([
      { table: "savings_rules", id: "rule-1", field: "annualAmount", value: 23_000 },
    ]);
  });

  it("skips retirement-age with a reason and does not emit an update", () => {
    const tree = makeTree();
    const { updates, skipped } = mutationsToBaseUpdates(tree, [
      { kind: "retirement-age", person: "client", age: 67 },
    ]);
    expect(updates).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].kind).toBe("retirement-age");
    expect(skipped[0].reason).toMatch(/scenario/i);
  });

  it("skips an unresolvable SS target (no SS row for the person)", () => {
    const tree = makeTree();
    const { updates, skipped } = mutationsToBaseUpdates(tree, [
      { kind: "ss-annual-amount", person: "spouse", amount: 35_000 },
    ]);
    expect(updates).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].kind).toBe("ss-annual-amount");
    expect(skipped[0].reason).toMatch(/social security|resolve|not found/i);
  });

  it("skips an unresolvable savings target (no rule for the account)", () => {
    const tree = makeTree();
    const { updates, skipped } = mutationsToBaseUpdates(tree, [
      { kind: "savings-contribution", accountId: "acct-missing", annualAmount: 1 },
    ]);
    expect(updates).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].kind).toBe("savings-contribution");
  });

  it("skips an unsupported mutation kind (e.g. ss-claim-age) with a reason", () => {
    const tree = makeTree();
    const muts: SolverMutation[] = [
      { kind: "ss-claim-age", person: "client", age: 70 },
    ];
    const { updates, skipped } = mutationsToBaseUpdates(tree, muts);
    expect(updates).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].kind).toBe("ss-claim-age");
  });

  it("handles a mixed batch: emits supported updates and skips the rest", () => {
    const tree = makeTree();
    const muts: SolverMutation[] = [
      { kind: "income-annual-amount", incomeId: "inc-1", annualAmount: 120_000 },
      { kind: "retirement-age", person: "client", age: 67 },
      { kind: "expense-annual-amount", expenseId: "exp-1", annualAmount: 72_000 },
    ];
    const { updates, skipped } = mutationsToBaseUpdates(tree, muts);
    expect(updates).toEqual([
      { table: "incomes", id: "inc-1", field: "annualAmount", value: 120_000 },
      { table: "expenses", id: "exp-1", field: "annualAmount", value: 72_000 },
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].kind).toBe("retirement-age");
  });
});
