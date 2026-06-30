// @vitest-environment jsdom
/**
 * TDD test for income dialog: "Linked Property" selector appears when type is
 * "other", and selecting a property grays out the Owner pill group + shows an
 * "Owner follows …" note.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
  accounts: [{ id: "re-1", name: "Rental Duplex", category: "real_estate", subType: "rental_property" }],
  ownerNames: { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  resolvedInflationRate: 0.024,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncomeDialog linked property", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the Linked Property selector for Other income and disables Owner when linked", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // Open the add-income dialog via the "+ Add" button in the Income section.
    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    // Change type to "other"
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "other" } });

    // Linked Property selector should now be visible
    const select = screen.getByLabelText(/linked property/i);
    expect(select).toBeInTheDocument();

    // Select the real estate account
    fireEvent.change(select, { target: { value: "re-1" } });

    // Owner pill group becomes disabled / non-interactive
    const ownerGroup = screen.getByRole("group", { name: /owner/i });
    expect(ownerGroup).toHaveAttribute("aria-disabled", "true");
    expect(ownerGroup.className).toContain("pointer-events-none");

    // "Owner follows …" note appears
    expect(screen.getByText(/owner follows/i)).toBeInTheDocument();
  });

  it("hides Linked Property selector when type is not 'other'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    // Default type is "salary" — no Linked Property selector
    expect(screen.queryByLabelText(/linked property/i)).not.toBeInTheDocument();
  });

  it("clears linked property when switching away from 'other'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    // Switch to "other" and select a property
    const typeSelect = screen.getByLabelText(/type/i);
    fireEvent.change(typeSelect, { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText(/linked property/i), { target: { value: "re-1" } });

    // Owner follows note is visible
    expect(screen.getByText(/owner follows/i)).toBeInTheDocument();

    // Switch away from "other"
    fireEvent.change(typeSelect, { target: { value: "salary" } });

    // Linked Property selector is gone and Owner follows note is gone
    expect(screen.queryByLabelText(/linked property/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/owner follows/i)).not.toBeInTheDocument();
  });
});
