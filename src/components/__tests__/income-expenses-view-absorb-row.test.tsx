// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

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

// An explicit plan start year: without `clientInfo` the view falls back to
// `new Date().getFullYear()`, which would make every current-vs-retirement
// assertion below silently change meaning at the next new year.
const CLIENT_INFO = {
  clientRetirementYear: 2040,
  clientEndYear: 2075,
  planStartYear: 2026,
  planEndYear: 2075,
};

/** The seeded RETIREMENT living row: anchored to client_retirement, starting
 *  well after plan start. */
function retirementSlot(over: Partial<ExpenseRow> = {}): ExpenseRow {
  return currentSlot({
    id: "slot-retirement",
    name: "Retirement Living Expenses",
    startYear: 2040,
    startYearRef: "client_retirement",
    endYearRef: "plan_end",
    ...over,
  });
}

function renderView(expenses: ExpenseRow[]) {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} clientInfo={CLIENT_INFO} initialExpenses={expenses} />
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

  // --- the absorb toggle is offered on the CURRENT row only ------------------

  it("offers the absorb toggle when editing the CURRENT living row", () => {
    renderView([currentSlot({})]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    expect(screen.getByText(/Spend whatever/)).toBeInTheDocument();
  });

  it("hides the absorb toggle when editing the RETIREMENT living row", () => {
    // The solver's retirement living-expense lever has no absorb guard, so a
    // retirement row that spent every leftover dollar would make the retirement
    // solve flat and its answer meaningless. The write layer rejects it too —
    // this is the affordance that stops the advisor reaching that 400 at all.
    renderView([retirementSlot()]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Retirement Living Expenses" }));
    expect(screen.queryByText(/Spend whatever/)).toBeNull();
  });
});

// The Guided Walkthrough's Cash Flow step renders this same view with
// `embed="wizard"` (see onboarding/steps/cash-flow-step.tsx), so an advisor
// setting the household up for the first time gets the option there too. The
// embed only drops the KPI strip today — this pins that, so a future
// wizard-specific branch can't quietly take the toggle with it.
describe("IncomeExpensesView — the option inside the Guided Walkthrough", () => {
  function renderWizard(expenses: ExpenseRow[]) {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          {...BASE_PROPS}
          clientInfo={CLIENT_INFO}
          initialExpenses={expenses}
          embed="wizard"
          section="cash-flow"
        />
      </ClientAccessProvider>,
    );
  }

  it("offers the absorb toggle on the CURRENT living row", () => {
    renderWizard([currentSlot({})]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    expect(screen.getByText(/Spend whatever/)).toBeInTheDocument();
  });

  it("shows an already-absorbing row as spending whatever's left", () => {
    renderWizard([currentSlot({ absorbsRemainingCashFlow: true })]);
    expect(screen.getByText("Whatever’s left")).toBeInTheDocument();
  });
});
