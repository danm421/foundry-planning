// @vitest-environment jsdom
/**
 * An already-retired household's Current living row ends the year before
 * retirement — in the past — so it spends nothing in the plan and its lever is
 * hidden. The test reads the WORKING row's years (applyMutations re-resolves
 * them), so moving retirement back into the future brings the lever back.
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

/** Retired in 2024: the current row resolves to end in 2023. */
const CURRENT_RETIRED = livingExpense({
  id: "slot-current",
  name: "Current Living Expenses",
  endYear: 2023,
  startYearRef: "plan_start",
  endYearRef: "client_retirement",
  isDefault: true,
});

const RETIREMENT_SLOT = livingExpense({
  id: "slot-retirement",
  name: "Retirement Living Expenses",
  annualAmount: 165000,
  startYear: 2024,
  startYearRef: "client_retirement",
  endYearRef: "plan_end",
  isDefault: true,
});

function leverNames(): string[] {
  return screen
    .queryAllByRole("spinbutton")
    .map((el) => el.getAttribute("aria-label")!);
}

function renderLevers(base: Expense[], working: Expense[] = base) {
  render(
    <SolverRowLivingExpenseScale
      baseExpenses={base}
      workingExpenses={working}
      currentYear={CURRENT_YEAR}
      onChange={vi.fn()}
      activeSolve={null}
      onSolveStart={vi.fn()}
      onSolveCancel={vi.fn()}
    />,
  );
}

describe("SolverRowLivingExpenseScale — already-retired household", () => {
  it("hides the Current living lever once its window has closed", () => {
    renderLevers([CURRENT_RETIRED, RETIREMENT_SLOT]);

    expect(leverNames()).toEqual(["Retirement Living Expenses"]);
  });

  it("shows it again when a working retirement-age change reopens the window", () => {
    // Base says retired; the advisor pushed retirement out to 2030 in the Solver.
    renderLevers([CURRENT_RETIRED, RETIREMENT_SLOT], [
      { ...CURRENT_RETIRED, endYear: 2029 },
      { ...RETIREMENT_SLOT, startYear: 2030 },
    ]);

    expect(leverNames()).toEqual(["Current Living Expenses", "Retirement Living Expenses"]);
  });

  it("hides it when a working change retires a still-working household", () => {
    const working = { ...CURRENT_RETIRED, endYear: 2034 };
    renderLevers([working, RETIREMENT_SLOT], [CURRENT_RETIRED, RETIREMENT_SLOT]);

    expect(leverNames()).toEqual(["Retirement Living Expenses"]);
  });

  // Retiring THIS year: the current row ends last year, so it never runs.
  it("treats retiring this year as already retired", () => {
    renderLevers([{ ...CURRENT_RETIRED, endYear: CURRENT_YEAR - 1 }, RETIREMENT_SLOT]);

    expect(leverNames()).toEqual(["Retirement Living Expenses"]);
  });
});
