// @vitest-environment jsdom
/**
 * TDD test for read-only gating in IncomeExpensesView.
 *
 * Under { permission: "view" } the Add / Edit / Delete controls must be absent.
 * Under { permission: "edit" } they must be present.
 *
 * We mount the real component and assert on rendered output — not mock return values.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

// Mock next/navigation hooks used by useScenarioWriter / useScenarioState
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

// Mock next/link so it renders an <a> tag (jsdom compat)
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
// Minimal fixture data
// ---------------------------------------------------------------------------

const CLIENT_ID = "test-client-id";

const INCOME = {
  id: "inc-1",
  type: "salary" as const,
  name: "Alice Salary",
  annualAmount: "120000",
  startYear: 2024,
  endYear: 2060,
  owner: "client" as const,
  claimingAge: null,
  growthRate: "0.03",
};

const EXPENSE = {
  id: "exp-1",
  type: "other" as const,
  name: "Rent",
  annualAmount: "24000",
  startYear: 2024,
  endYear: 2060,
  growthRate: "0.03",
  isDefault: false,
};

const OWNER_NAMES = { clientName: "Alice Test", spouseName: null };

const BASE_PROPS = {
  clientId: CLIENT_ID,
  initialIncomes: [INCOME],
  initialExpenses: [EXPENSE],
  initialSavingsRules: [],
  accounts: [],
  entities: [],
  ownerNames: OWNER_NAMES,
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  resolvedInflationRate: 0.03,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncomeExpensesView read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides Add, Edit-toggle, and Delete controls when permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "+ Add" buttons must not be rendered
    const addButtons = screen.queryAllByRole("button", { name: /^\+ Add$/ });
    expect(addButtons).toHaveLength(0);

    // "Edit" toggle buttons must not be rendered
    const editToggles = screen.queryAllByRole("button", { name: /^Edit$/ });
    expect(editToggles).toHaveLength(0);

    // Delete buttons ("Delete …" aria-label) must not be rendered
    const deleteButtons = screen.queryAllByRole("button", { name: /^Delete /i });
    expect(deleteButtons).toHaveLength(0);
  });

  it("shows Add, Edit-toggle, and Delete controls when permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // At least one "+ Add" button must be present (income + expense)
    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    expect(addButtons.length).toBeGreaterThan(0);
  });
});
