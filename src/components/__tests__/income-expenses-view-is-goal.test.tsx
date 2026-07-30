// @vitest-environment jsdom
/**
 * TDD test for the `isGoal` ("Show as a goal") checkbox on the detailed
 * Inflows & Outflows expense form (ExpenseDialog inside IncomeExpensesView).
 *
 * The Household Map's quick-edit drawer already exposes this flag; this test
 * covers the same flag on the older detailed page so the two editors agree:
 *   1. An editing row with isGoal: true hydrates the checkbox as checked.
 *   2. An education row always renders the checkbox checked AND disabled.
 *   3. Submitting the dialog sends isGoal in the request body (the write path
 *      that actually persists the flag).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn();

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialExpenses: [],
  initialSavingsRules: [],
  accounts: [],
  ownerNames: { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  // No inline scenario writes exercised here; the view refuses a write for a
  // row with no entry, which is the safe default for a fixture.
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
};

describe("ExpenseDialog isGoal checkbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-expense-id", ok: true, targetId: "new-expense-id" }),
    });
  });

  it("hydrates the checkbox as checked when editing a row with isGoal: true", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          {...BASE_PROPS}
          initialExpenses={[
            {
              id: "exp-1",
              type: "other",
              name: "Vacation Fund",
              annualAmount: "5000",
              startYear: 2024,
              endYear: 2040,
              growthRate: "0.02",
              isGoal: true,
            },
          ]}
        />
      </ClientAccessProvider>,
    );

    // The pencil, not the row: rows carrying inline cells give up their own
    // click handler, since it would swallow clicks meant for those cells.
    fireEvent.click(screen.getByRole("button", { name: "Edit Vacation Fund" }));

    expect(screen.getByLabelText(/show as a goal/i)).toBeChecked();
  });

  it("renders the checkbox checked AND disabled for an education row, regardless of stored isGoal", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          {...BASE_PROPS}
          initialExpenses={[
            {
              id: "exp-2",
              type: "education",
              name: "College Fund",
              annualAmount: "20000",
              startYear: 2030,
              endYear: 2034,
              growthRate: "0.02",
              isGoal: false,
            },
          ]}
        />
      </ClientAccessProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit College Fund" }));

    const checkbox = screen.getByLabelText(/show as a goal/i);
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });

  it("sends isGoal in the request body when submitting the dialog", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // Two "+ Add" buttons exist (Income panel first, Expenses panel second).
    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[1]);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "New Goal" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByLabelText(/show as a goal/i));

    fireEvent.click(screen.getByRole("button", { name: /add expense/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/expenses"));
    expect(call).toBeTruthy();
    const sentBody = JSON.parse((call![1] as RequestInit).body as string);
    expect(sentBody.isGoal).toBe(true);
  });
});
