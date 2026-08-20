// @vitest-environment jsdom
/**
 * The "spend whatever's left" option, offered on the solver's CURRENT living
 * expense lever so an advisor can test it as a what-if without leaving the
 * solver. Mirrors the Details cash-flow dialog — see
 * `src/components/__tests__/income-expenses-view-absorb-row.test.tsx` — and the
 * same rule applies here: the RETIREMENT row may not absorb, because the
 * `living-expense-scale` solve lever has no absorb guard.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Expense } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { SolverRowLivingExpenseScale } from "../solver-row-living-expense-scale";

const CURRENT_YEAR = 2026;

function livingExpense(over: Partial<Expense> & { id: string; name: string }): Expense {
  return {
    type: "living",
    annualAmount: 120000,
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

function renderLevers(
  expenses: Expense[],
  onChange: (m: SolverMutation) => void = vi.fn(),
  working: Expense[] = expenses,
) {
  render(
    <SolverRowLivingExpenseScale
      baseExpenses={expenses}
      workingExpenses={working}
      currentYear={CURRENT_YEAR}
      onChange={onChange}
      activeSolve={null}
      onSolveStart={vi.fn()}
      onSolveCancel={vi.fn()}
    />,
  );
}

const toggleName = /Spend whatever/;

describe("SolverRowLivingExpenseScale — spend whatever's left", () => {
  it("offers the toggle on the CURRENT living lever", () => {
    renderLevers([CURRENT_SLOT]);
    expect(screen.getByRole("checkbox", { name: toggleName })).toBeInTheDocument();
  });

  it("does NOT offer it on the RETIREMENT lever", () => {
    renderLevers([RETIREMENT_SLOT]);
    expect(screen.queryByRole("checkbox", { name: toggleName })).toBeNull();
  });

  it("emits an expense-absorbs-remaining mutation for that row when ticked", () => {
    const onChange = vi.fn();
    renderLevers([CURRENT_SLOT], onChange);
    fireEvent.click(screen.getByRole("checkbox", { name: toggleName }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "expense-absorbs-remaining",
      expenseId: "slot-current",
      value: true,
    });
  });

  it("reads its checked state off the WORKING tree, so a reset follows", () => {
    renderLevers(
      [CURRENT_SLOT],
      vi.fn(),
      [{ ...CURRENT_SLOT, absorbsRemainingCashFlow: true }],
    );
    expect(screen.getByRole("checkbox", { name: toggleName })).toBeChecked();
  });

  it("renames the amount field to the floor it becomes while absorbing", () => {
    renderLevers(
      [CURRENT_SLOT],
      vi.fn(),
      [{ ...CURRENT_SLOT, absorbsRemainingCashFlow: true }],
    );
    expect(
      screen.getByRole("spinbutton", { name: "Current Living Expenses (minimum)" }),
    ).toBeInTheDocument();
  });

  it("leaves the amount field named plainly when the row does not absorb", () => {
    // The control: without it, always appending "(minimum)" would still pass.
    renderLevers([CURRENT_SLOT]);
    expect(
      screen.getByRole("spinbutton", { name: "Current Living Expenses" }),
    ).toBeInTheDocument();
  });

  it("turns any OTHER absorbing living row off in the same edit", () => {
    // The write layer permits at most one absorbing row per plan, and
    // save-to-base does NOT go through it — so the invariant is kept here.
    const groceries = livingExpense({ id: "exp-groceries", name: "Groceries" });
    const onChange = vi.fn();
    renderLevers(
      [CURRENT_SLOT, groceries],
      onChange,
      [CURRENT_SLOT, { ...groceries, absorbsRemainingCashFlow: true }],
    );
    fireEvent.click(
      screen.getAllByRole("checkbox", { name: toggleName })[0],
    );
    expect(onChange).toHaveBeenCalledWith({
      kind: "expense-absorbs-remaining",
      expenseId: "exp-groceries",
      value: false,
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "expense-absorbs-remaining",
      expenseId: "slot-current",
      value: true,
    });
  });

  it("does not touch other rows when UNticking", () => {
    const onChange = vi.fn();
    renderLevers(
      [CURRENT_SLOT],
      onChange,
      [{ ...CURRENT_SLOT, absorbsRemainingCashFlow: true }],
    );
    fireEvent.click(screen.getByRole("checkbox", { name: toggleName }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      kind: "expense-absorbs-remaining",
      expenseId: "slot-current",
      value: false,
    });
  });
});
