// @vitest-environment jsdom
/**
 * The two seeded living-expense slots lead the solver's Living Expenses levers,
 * Current then Retirement, whatever order the base tree returned them in.
 *
 * Mirrors the Details cash-flow assertion in
 * `src/components/__tests__/income-expenses-view-living-order.test.tsx` — both
 * surfaces sort by the shared `livingSlotRank`, so an advisor moving between
 * them reads the rows in one order.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Expense } from "@/engine";
import { SolverRowLivingExpenseScale } from "../solver-row-living-expense-scale";

const CURRENT_YEAR = 2026;

function livingExpense(over: Partial<Expense> & { id: string; name: string }): Expense {
  return {
    type: "living",
    annualAmount: 12000,
    startYear: CURRENT_YEAR,
    endYear: 2060,
    growthRate: 0.024,
    ...over,
  } as Expense;
}

const CURRENT_SLOT = livingExpense({
  id: "slot-current",
  name: "Current Living Expenses",
  startYearRef: "plan_start",
  endYearRef: "client_retirement",
  isDefault: true,
});

const RETIREMENT_SLOT = livingExpense({
  id: "slot-retirement",
  name: "Retirement Living Expenses",
  annualAmount: 165000,
  startYear: 2035,
  startYearRef: "client_retirement",
  endYearRef: "plan_end",
  isDefault: true,
});

const GROCERIES = livingExpense({ id: "exp-groceries", name: "Groceries" });
const TRAVEL = livingExpense({ id: "exp-travel", name: "Travel" });

/** Lever labels top to bottom — each row's stepper carries the row's name. */
function leverNames(): string[] {
  return screen
    .getAllByRole("spinbutton")
    .map((el) => el.getAttribute("aria-label")!);
}

function renderLevers(expenses: Expense[]) {
  render(
    <SolverRowLivingExpenseScale
      baseExpenses={expenses}
      workingExpenses={expenses}
      currentYear={CURRENT_YEAR}
      onChange={vi.fn()}
      activeSolve={null}
      onSolveStart={vi.fn()}
      onSolveCancel={vi.fn()}
    />,
  );
}

describe("SolverRowLivingExpenseScale — lever order", () => {
  it("pins the seeded slots above the itemized rows, Current then Retirement", () => {
    // Base order deliberately scrambled: retirement first, current last.
    renderLevers([RETIREMENT_SLOT, GROCERIES, TRAVEL, CURRENT_SLOT]);

    expect(leverNames()).toEqual([
      "Current Living Expenses",
      "Retirement Living Expenses",
      "Groceries",
      "Travel",
    ]);
  });

  // THE case a name-based pin cannot handle. Both slots are renameable, and the
  // household that surfaced this had renamed its current slot "My Spending".
  it("pins a RENAMED current slot, because the rank reads the milestone not the name", () => {
    renderLevers([RETIREMENT_SLOT, GROCERIES, { ...CURRENT_SLOT, name: "My Spending" }]);

    expect(leverNames()).toEqual([
      "My Spending",
      "Retirement Living Expenses",
      "Groceries",
    ]);
  });

  // Its own `it`: the two above pass on an implementation that reorders every
  // non-default row too — each has only one stable pair to preserve.
  it("leaves the non-default rows in the order they arrived", () => {
    renderLevers([TRAVEL, RETIREMENT_SLOT, GROCERIES, CURRENT_SLOT]);

    expect(leverNames()).toEqual([
      "Current Living Expenses",
      "Retirement Living Expenses",
      "Travel",
      "Groceries",
    ]);
  });

  // A row is only pinned if it is BOTH `isDefault` and milestone-anchored. An
  // advisor-created row anchored to plan_start is ordinary detail.
  it("does not pin a non-default row that happens to start at plan_start", () => {
    renderLevers([
      GROCERIES,
      livingExpense({ id: "exp-mortgage", name: "Mortgage", startYearRef: "plan_start" }),
      CURRENT_SLOT,
    ]);

    expect(leverNames()).toEqual(["Current Living Expenses", "Groceries", "Mortgage"]);
  });

  // The lever list is derived from a `filter`, but sorting a shared array in
  // place would still be a real hazard if that ever changed.
  it("does not reorder the caller's expense array", () => {
    const expenses = [RETIREMENT_SLOT, GROCERIES, CURRENT_SLOT];
    renderLevers(expenses);

    expect(expenses.map((e) => e.id)).toEqual([
      "slot-retirement",
      "exp-groceries",
      "slot-current",
    ]);
  });
});
