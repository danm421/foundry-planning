// @vitest-environment jsdom
/**
 * TDD test for income dialog layout change: Growth Rate must sit beside
 * Annual Amount (single column each), not span two columns.
 *
 * Binding contract: the Growth Rate block must NOT carry `col-span-2`.
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
  accounts: [],
  ownerNames: { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  resolvedInflationRate: 0.024,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("income dialog layout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders Growth Rate beside Annual Amount (no col-span-2 on growth block)", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // Open the add-income dialog via the "+ Add" button in the Income section.
    // When there are no incomes, there is exactly one "+ Add" button in the income section.
    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    // The first "+ Add" button is in the Income section header
    fireEvent.click(addButtons[0]);

    // Dialog should now be open — find the "Growth Rate" label
    const growthLabel = screen.getByText("Growth Rate");

    // The growth block (closest div ancestor) must NOT carry the full-width class
    const growthBlock = growthLabel.closest("div");
    expect(growthBlock?.className).not.toContain("col-span-2");
  });
});
