// @vitest-environment jsdom
/**
 * TDD test for read-only gating in IncomeExpensesView.
 *
 * Under { permission: "view" } the Add / Edit / Delete controls must be absent,
 * SS rows must be non-interactive (no button), and SavingsRulesList controls absent.
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

// Social Security income row — drives ssClientInfo && ssPlanSettings branch
const SS_INCOME = {
  id: "inc-ss-1",
  type: "social_security" as const,
  name: "Social Security",
  annualAmount: "24000",
  startYear: 2030,
  endYear: 2060,
  owner: "client" as const,
  claimingAge: 67,
  growthRate: "0.02",
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

// A savings rule so SavingsRulesList renders a real row
const SAVINGS_RULE = {
  id: "sr-1",
  accountId: "acct-1",
  annualAmount: "6000",
  annualPercent: null,
  contributeMax: false,
  startYear: 2024,
  endYear: 2060,
  growthRate: null,
  growthSource: null,
  employerMatchPct: null,
  employerMatchCap: null,
  employerMatchAmount: null,
};

const ACCOUNT = {
  id: "acct-1",
  name: "401k",
  category: "retirement",
  subType: "traditional_401k",
};

const OWNER_NAMES = { clientName: "Alice Test", spouseName: null };

// ssClientInfo + ssPlanSettings — minimal shapes to satisfy SS card render
const SS_CLIENT_INFO = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1960-05-15",
  retirementAge: 67,
  planEndAge: 95,
  filingStatus: "single" as const,
};

const SS_PLAN_SETTINGS = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2024,
  planEndYear: 2060,
};

const BASE_PROPS = {
  clientId: CLIENT_ID,
  initialIncomes: [INCOME, SS_INCOME],
  initialExpenses: [EXPENSE],
  initialSavingsRules: [SAVINGS_RULE],
  accounts: [ACCOUNT],
  entities: [],
  ownerNames: OWNER_NAMES,
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  resolvedInflationRate: 0.03,
  ssClientInfo: SS_CLIENT_INFO,
  ssPlanSettings: SS_PLAN_SETTINGS,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncomeExpensesView read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides Add, Edit-toggle, Delete, and SavingsRules controls; SS rows are non-interactive when permission='view'", () => {
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

    // SavingsRulesList: "+ Add savings rule" button must not be present
    const addSavingsBtn = screen.queryByRole("button", { name: /add savings rule/i });
    expect(addSavingsBtn).toBeNull();

    // SS row for "Alice" must be present as text (data visible) but NOT a button
    const ssSection = screen.getByText("Alice");
    // The parent element should not be a button (read-only row renders as div)
    const rowEl = ssSection.closest("button");
    expect(rowEl).toBeNull();
  });

  it("shows Add, Edit-toggle, Delete, SavingsRules controls, and interactive SS rows when permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // At least one "+ Add" button must be present (income + expense)
    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    expect(addButtons.length).toBeGreaterThan(0);

    // SavingsRulesList: "+ Add savings rule" button must be present (rule exists but add still shown)
    const addSavingsBtn = screen.queryByRole("button", { name: /add savings rule/i });
    expect(addSavingsBtn).not.toBeNull();

    // SavingsRulesList per-row Edit button must be present
    const editBtns = screen.queryAllByRole("button", { name: /^Edit$/ });
    expect(editBtns.length).toBeGreaterThan(0);

    // SS row for "Alice" must be a button (interactive)
    const ssText = screen.getByText("Alice");
    const ssBtn = ssText.closest("button");
    expect(ssBtn).not.toBeNull();
  });
});
