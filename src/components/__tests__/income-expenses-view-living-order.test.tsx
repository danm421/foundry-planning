// @vitest-environment jsdom
/**
 * The two seeded living-expense slots lead the Living Expenses group, Current
 * then Retirement, whatever order the server returned.
 *
 * The rows arrive in `initialExpenses` order, which is the effective tree's
 * order — not plan order — so a real household showed Retirement above the
 * itemized rows and its own Current slot dead last. The fix ranks by
 * `livingSlotRole` (start milestone), which is what makes the renamed-slot case
 * below the load-bearing test: a name-based pin passes every other case here.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/details/income-expenses",
}));

import IncomeExpensesView, {
  type IncomeExpensesViewProps,
} from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

type ExpenseRow = IncomeExpensesViewProps["initialExpenses"][number];

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialSavingsRules: [],
  accounts: [],
  ownerNames: { clientName: "Cooper Sample", spouseName: "Susan Sample" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
};

function livingExpense(over: Partial<ExpenseRow> & { id: string; name: string }): ExpenseRow {
  return {
    type: "living",
    annualAmount: "12000",
    startYear: 2026,
    endYear: 2060,
    growthRate: "0.024",
    ...over,
  };
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
  startYearRef: "client_retirement",
  endYearRef: "plan_end",
  isDefault: true,
});

const GROCERIES = livingExpense({ id: "exp-groceries", name: "Groceries" });
const TRAVEL = livingExpense({ id: "exp-travel", name: "Travel" });

/**
 * Row labels under the LIVING EXPENSES group header, top to bottom — read off
 * each row's pencil.
 *
 * The lookahead is load-bearing: a living row ALSO renders an inline amount
 * editor labelled "Edit amount for X", so a bare /^Edit / matches twice per row
 * and interleaves the two into the assertion.
 */
function livingRowNames(): string[] {
  const label = screen.getByText("Living Expenses");
  // span → header's left cluster → header row → group root (see Group's markup
  // in `income-expenses/group.tsx`).
  const group = label.closest("div")!.parentElement!.parentElement!;
  return within(group)
    .getAllByRole("button", { name: /^Edit (?!amount for )/ })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Edit /, ""));
}

function renderView(expenses: ExpenseRow[]) {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} initialExpenses={expenses} />
    </ClientAccessProvider>,
  );
}

describe("IncomeExpensesView — living-expense order", () => {
  it("pins the seeded slots above the itemized rows, Current then Retirement", () => {
    // Server order deliberately scrambled: retirement first, current last.
    renderView([RETIREMENT_SLOT, GROCERIES, TRAVEL, CURRENT_SLOT]);

    expect(livingRowNames()).toEqual([
      "Current Living Expenses",
      "Retirement Living Expenses",
      "Groceries",
      "Travel",
    ]);
  });

  // THE case a name-based pin cannot handle. Both slots are renameable, and the
  // household that surfaced this bug had renamed its current slot.
  it("pins a RENAMED current slot, because the rank reads the milestone not the name", () => {
    renderView([
      RETIREMENT_SLOT,
      GROCERIES,
      { ...CURRENT_SLOT, name: "My Spending" },
    ]);

    expect(livingRowNames()).toEqual([
      "My Spending",
      "Retirement Living Expenses",
      "Groceries",
    ]);
  });

  // Its own `it`: the two above pass on an implementation that reorders every
  // non-default row too (they each have only one stable pair to preserve).
  it("leaves the non-default rows in the order they arrived", () => {
    renderView([TRAVEL, RETIREMENT_SLOT, GROCERIES, CURRENT_SLOT]);

    expect(livingRowNames()).toEqual([
      "Current Living Expenses",
      "Retirement Living Expenses",
      "Travel",
      "Groceries",
    ]);
  });

  // A row is only pinned if it is BOTH `isDefault` and milestone-anchored. An
  // advisor-created row anchored to plan_start is ordinary detail.
  it("does not pin a non-default row that happens to start at plan_start", () => {
    renderView([
      GROCERIES,
      livingExpense({ id: "exp-anchored", name: "Mortgage", startYearRef: "plan_start" }),
      CURRENT_SLOT,
    ]);

    expect(livingRowNames()).toEqual([
      "Current Living Expenses",
      "Groceries",
      "Mortgage",
    ]);
  });
});
