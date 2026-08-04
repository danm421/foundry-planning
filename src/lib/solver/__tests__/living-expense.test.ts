import { describe, it, expect } from "vitest";
import type { ClientData, Expense } from "@/engine/types";
import {
  isRetirementLivingExpense,
  roundToNearest5k,
  retirementLivingExpenseTotal,
  synthesizeRetirementLivingExpense,
  livingExpenseSolveMutations,
} from "../living-expense";
import { applyMutations } from "../apply-mutations";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "../types";

function expense(over: Partial<Expense>): Expense {
  return {
    id: "e",
    type: "living",
    name: "Living",
    annualAmount: 0,
    startYear: 2040,
    endYear: 2070,
    growthRate: 0.025,
    ...over,
  } as Expense;
}

describe("isRetirementLivingExpense", () => {
  it("is true only for living expenses that begin after plan start", () => {
    expect(isRetirementLivingExpense(expense({ startYear: 2040 }), 2026)).toBe(true);
    // current (working-year) living expense, anchored to plan start
    expect(isRetirementLivingExpense(expense({ startYear: 2026 }), 2026)).toBe(false);
    // non-living rows never count
    expect(
      isRetirementLivingExpense(expense({ type: "insurance", startYear: 2040 }), 2026),
    ).toBe(false);
  });

  // Already-retired clients: client_retirement resolves to a past year, so the
  // retirement row's startYear is <= plan start. It must still be recognized via
  // its retirement anchor (otherwise the PoS solve synthesizes a duplicate and
  // returns "unreachable" at $0).
  it("recognizes a retirement-anchored row that began in the past", () => {
    expect(
      isRetirementLivingExpense(
        expense({ startYear: 2017, endYear: 2054, startYearRef: "client_retirement" }),
        2026,
      ),
    ).toBe(true);
    // spouse_retirement anchor counts too
    expect(
      isRetirementLivingExpense(
        expense({ startYear: 2020, endYear: 2054, startYearRef: "spouse_retirement" }),
        2026,
      ),
    ).toBe(true);
    // the working-phase row (anchored to plan_start, ends at retirement in the
    // past) is NOT retirement spend
    expect(
      isRetirementLivingExpense(
        expense({ startYear: 2026, endYear: 2016, startYearRef: "plan_start" }),
        2026,
      ),
    ).toBe(false);
    // a retirement-anchored row that fully ended before the plan is inactive
    expect(
      isRetirementLivingExpense(
        expense({ startYear: 2010, endYear: 2020, startYearRef: "client_retirement" }),
        2026,
      ),
    ).toBe(false);
  });
});

describe("roundToNearest5k", () => {
  it("rounds to the nearest $5,000", () => {
    expect(roundToNearest5k(117_400)).toBe(115_000);
    expect(roundToNearest5k(117_600)).toBe(120_000);
    expect(roundToNearest5k(113_700)).toBe(115_000);
    expect(roundToNearest5k(0)).toBe(0);
  });
});

describe("retirementLivingExpenseTotal", () => {
  it("sums only living expenses that start after plan start", () => {
    const tree = {
      planSettings: { planStartYear: 2026 },
      expenses: [
        expense({ id: "current", annualAmount: 80_000, startYear: 2026 }), // working-year
        expense({ id: "ret1", annualAmount: 90_000, startYear: 2040 }), // retirement
        expense({ id: "ret2", annualAmount: 10_000, startYear: 2045 }), // retirement
        expense({ id: "ins", type: "insurance", annualAmount: 5_000, startYear: 2041 }),
      ],
    } as unknown as ClientData;
    expect(retirementLivingExpenseTotal(tree)).toBe(100_000);
  });

  it("is 0 when there are no retirement living expenses", () => {
    const tree = {
      planSettings: { planStartYear: 2026 },
      expenses: [expense({ annualAmount: 80_000, startYear: 2026 })],
    } as unknown as ClientData;
    expect(retirementLivingExpenseTotal(tree)).toBe(0);
  });
});

describe("synthesizeRetirementLivingExpense", () => {
  it("builds a retirement-anchored living expense at the given amount", () => {
    const tree = {
      planSettings: { planStartYear: 2026, planEndYear: 2070, inflationRate: 0.025 },
      client: { retirementAge: 65 },
      expenses: [],
    } as unknown as ClientData;

    const e = synthesizeRetirementLivingExpense(tree, 80_000);
    expect(e.type).toBe("living");
    expect(e.annualAmount).toBe(80_000);
    expect(e.startYearRef).toBe("client_retirement");
    expect(e.endYearRef).toBe("plan_end");
    expect(e.growthRate).toBe(0.025);
    expect(typeof e.id).toBe("string");
    expect(e.id.length).toBeGreaterThan(0);
  });
});

/** A tree complete enough to round-trip through applyMutations. */
function applyableTree(expenses: Expense[]): ClientData {
  return {
    planSettings: { planStartYear: 2026, planEndYear: 2070, inflationRate: 0.025 },
    client: { retirementAge: 65 },
    accounts: [],
    incomes: [],
    expenses,
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    giftEvents: [],
  } as unknown as ClientData;
}

describe("livingExpenseSolveMutations", () => {
  function treeWith(expenses: Expense[]): ClientData {
    return applyableTree(expenses);
  }

  it("writes one per-row expense-annual-amount, proportionally split", () => {
    const tree = treeWith([
      expense({ id: "current", annualAmount: 80_000, startYear: 2026 }),
      expense({ id: "ret1", annualAmount: 90_000, startYear: 2040 }),
      expense({ id: "ret2", annualAmount: 10_000, startYear: 2045 }),
    ]);
    expect(livingExpenseSolveMutations(tree, 120_000)).toEqual([
      { kind: "expense-annual-amount", expenseId: "ret1", annualAmount: 108_000 },
      { kind: "expense-annual-amount", expenseId: "ret2", annualAmount: 12_000 },
    ]);
  });

  it("upserts a stable-id row when the plan has no retirement living expense", () => {
    const tree = treeWith([expense({ id: "current", annualAmount: 80_000, startYear: 2026 })]);
    const [m] = livingExpenseSolveMutations(tree, 95_000);
    expect(m.kind).toBe("expense-upsert");
    // The id must be minted ONCE here, not re-rolled inside applyMutations on
    // every recompute — otherwise the row can never be addressed by a later edit.
    const applied = applyMutations(tree, [m]);
    const again = applyMutations(tree, [m]);
    expect(applied.expenses.at(-1)!.id).toBe(again.expenses.at(-1)!.id);
    expect(applied.expenses.at(-1)!.annualAmount).toBe(95_000);
  });
});

// The reported bug: after a Maximum Retirement Spend solve, the stepper's +/-
// buttons committed but the number on screen never moved. `living-expense-amount`
// and `expense-annual-amount:<id>` are different mutation keys, so both stayed
// live in the workspace's Map; apply order follows FIRST insertion, so a field
// edited before the solve kept its earlier slot and the solve's aggregate
// re-normalized the row on top of every later step.
describe("solve write-back leaves the stepper in control", () => {
  const RETIREMENT_ROW = "ret";

  function base(): ClientData {
    return applyableTree([
      expense({ id: "current", annualAmount: 120_000, startYear: 2026 }),
      expense({ id: RETIREMENT_ROW, annualAmount: 80_000, startYear: 2040 }),
    ]);
  }

  /** Mirrors live-solver-workspace: a keyed Map read out in insertion order. */
  function workspace() {
    const map = new Map<SolverMutationKey, SolverMutation>();
    return {
      push: (...ms: SolverMutation[]) => ms.forEach((m) => map.set(mutationKey(m), m)),
      reading: () =>
        applyMutations(base(), Array.from(map.values())).expenses.find(
          (e) => e.id === RETIREMENT_ROW,
        )!.annualAmount,
    };
  }

  it("steps move the value when the field was edited BEFORE the solve", () => {
    const ws = workspace();
    // Advisor nudges the field first — this is what used to pin it.
    ws.push({
      kind: "expense-annual-amount",
      expenseId: RETIREMENT_ROW,
      annualAmount: 85_000,
    });
    // Then solves.
    ws.push(...livingExpenseSolveMutations(base(), 95_000));
    expect(ws.reading()).toBe(95_000);

    // Now three +$5k steps must actually land.
    const readings: number[] = [];
    for (let i = 0; i < 3; i++) {
      ws.push({
        kind: "expense-annual-amount",
        expenseId: RETIREMENT_ROW,
        annualAmount: ws.reading() + 5_000,
      });
      readings.push(ws.reading());
    }
    expect(readings).toEqual([100_000, 105_000, 110_000]);
  });

  it("a re-solve still overrides an intervening manual step", () => {
    const ws = workspace();
    ws.push(...livingExpenseSolveMutations(base(), 95_000));
    ws.push({
      kind: "expense-annual-amount",
      expenseId: RETIREMENT_ROW,
      annualAmount: 130_000,
    });
    expect(ws.reading()).toBe(130_000);
    // Solving again must win over the manual edit, not lose to it.
    ws.push(...livingExpenseSolveMutations(base(), 90_000));
    expect(ws.reading()).toBe(90_000);
  });
});
