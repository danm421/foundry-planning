// @vitest-environment jsdom
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

function currentSlot(over: Partial<ExpenseRow>): ExpenseRow {
  return {
    id: "slot-current",
    name: "Current Living Expenses",
    type: "living",
    annualAmount: "0",
    startYear: 2026,
    endYear: 2060,
    growthRate: "0.024",
    startYearRef: "plan_start",
    endYearRef: "client_retirement",
    isDefault: true,
    ...over,
  } as ExpenseRow;
}

function renderView(expenses: ExpenseRow[]) {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} initialExpenses={expenses} />
    </ClientAccessProvider>,
  );
}

// ⚠️ The rendered string uses a TYPOGRAPHIC apostrophe (&rsquo;). Asserting the
// ASCII "Whatever's left" against rendered "Whatever’s left" is a known
// false-red in this repo — every assertion below uses ’ deliberately.
describe("IncomeExpensesView — a living row that spends whatever's left", () => {
  it("renders “Whatever’s left” instead of a dollar amount", () => {
    renderView([currentSlot({ absorbsRemainingCashFlow: true })]);
    const cell = screen.getByText("Whatever’s left");
    expect(cell).toBeInTheDocument();
    // Scoped to the row: the page's summary tiles legitimately read $0, so a
    // page-wide query for "$0" would match those and never see this row at all.
    const row = cell.closest("div.flex.items-center.justify-between") as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).queryByText("$0")).toBeNull();
  });

  it("names the floor on the meta line, keeping the value cell narrow", () => {
    // The floor deliberately does NOT ride in the value cell: that column is
    // sized for a currency figure, and a combined string squeezed the row's
    // name out of the layout entirely (caught in the browser, not here).
    renderView([
      currentSlot({ absorbsRemainingCashFlow: true, annualAmount: "80000" }),
    ]);
    expect(screen.getByText("Whatever’s left")).toBeInTheDocument();
    expect(screen.getByText("min $80,000")).toBeInTheDocument();
    expect(screen.queryByText("Whatever’s left · min $80,000")).toBeNull();
  });

  it("shows no floor meta when the floor is $0", () => {
    renderView([currentSlot({ absorbsRemainingCashFlow: true })]);
    expect(screen.queryByText(/^min \$/)).toBeNull();
  });

  it("drops the inline amount editor, so the floor is edited in the dialog", () => {
    renderView([currentSlot({ absorbsRemainingCashFlow: true })]);
    expect(
      screen.queryByRole("button", { name: /Edit amount for Current Living Expenses/i }),
    ).toBeNull();
  });

  it("leaves an ordinary living row inline-editable", () => {
    // The control. Without it, deleting the whole inline-amount branch would
    // still pass the case above.
    renderView([currentSlot({})]);
    expect(
      screen.getByRole("button", { name: /Edit amount for Current Living Expenses/i }),
    ).toBeInTheDocument();
  });
});
