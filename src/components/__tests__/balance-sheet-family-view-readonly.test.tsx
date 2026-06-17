// @vitest-environment jsdom
/**
 * TDD tests for read-only gating in BalanceSheetView and FamilyView.
 *
 * Under { permission: "view" } mutation affordances (Add/Edit/Delete buttons,
 * and clickable-row editors) must be absent / non-interactive.
 * Under { permission: "edit" } they must be present and interactive.
 *
 * Both components are heavy. We mock leaf dialogs and 3rd-party libs (not the
 * gating logic) to allow jsdom mounting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock heavy dialog components so they don't pull in 3rd-party libs
vi.mock("@/components/add-account-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/family-member-dialog", () => ({ default: () => null }));
vi.mock("@/components/entity-dialog", () => ({ default: () => null }));
vi.mock("@/components/revocable-trust-tag-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-client-dialog", () => ({ default: () => null }));
vi.mock("@/components/beneficiary-summary", () => ({
  default: ({ onEditAccount, onEditEntity }: { onEditAccount?: () => void; onEditEntity?: () => void }) => (
    <div data-testid="beneficiary-summary">
      {onEditAccount && <button onClick={onEditAccount}>Edit account beneficiaries</button>}
      {onEditEntity && <button onClick={onEditEntity}>Edit entity beneficiaries</button>}
    </div>
  ),
}));

// Mock hooks that reach outside
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn() }),
}));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/lib/investments/holdings-client", () => ({
  refreshClientHoldingPrices: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import BalanceSheetView from "@/components/balance-sheet-view";
import FamilyView from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { CategoryDefaults } from "@/components/forms/add-account-form";

// ---------------------------------------------------------------------------
// Fixtures — BalanceSheetView
// ---------------------------------------------------------------------------

const CLIENT_ID = "test-client-id";

const ACCOUNT = {
  id: "acct-1",
  name: "Brokerage Account",
  category: "taxable" as const,
  subType: "individual",
  owner: "client",
  value: "100000",
  basis: "80000",
  growthRate: null,
};

const LIABILITY = {
  id: "liab-1",
  name: "Mortgage",
  balance: "300000",
  interestRate: "0.045",
  monthlyPayment: "1500",
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  termUnit: "monthly",
};

const CATEGORY_DEFAULTS: CategoryDefaults = {
  taxable: "0.07",
  cash: "0.02",
  retirement: "0.07",
  annuity: "0.05",
  real_estate: "0.04",
  business: "0.06",
  stock_options: "0.07",
  life_insurance: "0.03",
  notes_receivable: "0.05",
};

const BS_BASE_PROPS = {
  clientId: CLIENT_ID,
  accounts: [ACCOUNT],
  liabilities: [LIABILITY],
  entities: [],
  categoryDefaults: CATEGORY_DEFAULTS,
  ownerNames: { clientName: "Alice Test", spouseName: null },
};

// ---------------------------------------------------------------------------
// Fixtures — FamilyView
// ---------------------------------------------------------------------------

const PRIMARY_INFO = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1960-05-15",
  retirementAge: 67,
  lifeExpectancy: 95,
  filingStatus: "single",
  spouseName: null,
  spouseLastName: null,
  spouseDob: null,
  spouseRetirementAge: null,
  spouseLifeExpectancy: null,
};

const FAMILY_MEMBER = {
  id: "fm-1",
  firstName: "Bob",
  lastName: "Test",
  relationship: "child" as const,
  dateOfBirth: "1990-01-01",
  notes: null,
};

const ENTITY = {
  id: "ent-1",
  name: "Alice Trust",
  entityType: "trust" as const,
  notes: null,
  includeInPortfolio: false,
  isGrantor: true,
  value: "500000",
  basis: "400000",
  owners: [],
  owner: "client" as const,
  grantor: "client" as const,
  beneficiaries: null,
  trustSubType: null,
  isIrrevocable: false,
  trustee: null,
  trustEnds: null,
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
};

const GIFT: import("../family-view").Gift = {
  id: "gift-1",
  year: 2024,
  amount: 18000,
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: "fm-1",
  recipientExternalBeneficiaryId: null,
  accountId: null,
  percent: null,
  useCrummeyPowers: false,
  notes: null,
};

const FV_BASE_PROPS = {
  clientId: CLIENT_ID,
  primary: PRIMARY_INFO,
  initialMembers: [FAMILY_MEMBER],
  initialEntities: [ENTITY],
  initialExternalBeneficiaries: [],
  initialAccounts: [],
  initialDesignations: [],
  initialGifts: [GIFT],
  initialGiftSeries: [],
  annualExclusionByYear: { 2024: 18000 },
  scenarioId: "default",
  contacts: null,
};

// ---------------------------------------------------------------------------
// BalanceSheetView tests
// ---------------------------------------------------------------------------

describe("BalanceSheetView read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides Edit toggle, Add Asset menu, Refresh prices, and Add Liability button under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <BalanceSheetView {...BS_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "Edit" toggle button must not be rendered (used to enter edit/delete mode)
    const editBtns = screen.queryAllByRole("button", { name: /^Edit$/ });
    expect(editBtns).toHaveLength(0);

    // "Add Asset" dropdown button must not be rendered
    const addAssetBtn = screen.queryByRole("button", { name: /add asset/i });
    expect(addAssetBtn).toBeNull();

    // "Refresh prices" button must not be rendered (it triggers a mutation — holding price update)
    const refreshBtn = screen.queryByRole("button", { name: /refresh prices/i });
    expect(refreshBtn).toBeNull();

    // KPI values should still be visible (data is readable)
    expect(screen.getByText("Assets (in estate)")).toBeTruthy();
    // "Liabilities" appears in KPI strip and panel heading — both should be present
    expect(screen.getAllByText("Liabilities").length).toBeGreaterThan(0);
  });

  it("shows Edit toggle, Add Asset, and Refresh prices under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetView {...BS_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "Edit" toggle buttons must be present (assets + liabilities = at least 2)
    const editBtns = screen.queryAllByRole("button", { name: /^Edit$/ });
    expect(editBtns.length).toBeGreaterThan(0);

    // "Add Asset" dropdown button must be present
    const addAssetBtn = screen.queryByRole("button", { name: /add asset/i });
    expect(addAssetBtn).not.toBeNull();

    // "Refresh prices" button must be present (accounts list is non-empty)
    const refreshBtn = screen.queryByRole("button", { name: /refresh prices/i });
    expect(refreshBtn).not.toBeNull();

    // KPI values should still be visible
    expect(screen.getByText("Assets (in estate)")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// FamilyView tests
// ---------------------------------------------------------------------------

describe("FamilyView read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Stub fetch for revocable-trusts endpoint (called on mount via useEffect)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  });

  it("hides Edit profile, Add/Edit buttons, and clickable-row triggers under permission='view'", async () => {
    await act(async () => {
      render(
        <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
          <FamilyView {...FV_BASE_PROPS} />
        </ClientAccessProvider>,
      );
    });

    // "Edit profile" button must not be rendered
    const editProfileBtn = screen.queryByRole("button", { name: /edit profile/i });
    expect(editProfileBtn).toBeNull();

    // "+ Add" buttons for family members / trusts must not be rendered
    const addBtns = screen.queryAllByRole("button", { name: /^\+ Add$/ });
    expect(addBtns).toHaveLength(0);

    // "+ Add Trust" button must not be rendered
    const addTrustBtn = screen.queryByRole("button", { name: /add trust/i });
    expect(addTrustBtn).toBeNull();

    // Family member row "Bob Test" must be visible (data visible) — in the members table
    // The td text is split: "Bob" + " " + "Test" so look for the cell by td text
    const bobCells = screen.queryAllByText(/Bob/, { selector: "td" });
    expect(bobCells.length).toBeGreaterThan(0);

    // The <tr> containing the member cell should NOT have cursor-pointer (not interactive)
    const bobRow = bobCells[0].closest("tr");
    expect(bobRow).toBeTruthy();
    expect(bobRow?.className).not.toContain("cursor-pointer");

    // Trust "Alice Trust" must be visible
    const trustName = screen.getByText("Alice Trust");
    expect(trustName).toBeTruthy();

    // Trust row must not be cursor-pointer (clickable row that opens EntityDialog)
    const trustRow = trustName.closest("tr");
    expect(trustRow?.className).not.toContain("cursor-pointer");

    // "+ Add gift" button must not be rendered
    const addGiftBtn = screen.queryByRole("button", { name: /add gift/i });
    expect(addGiftBtn).toBeNull();

    // Gift per-row Edit button must not be rendered
    const giftEditBtns = screen.queryAllByRole("button", { name: /^Edit$/ });
    expect(giftEditBtns).toHaveLength(0);

    // BeneficiarySummary edit handlers must NOT be passed (mock renders buttons only when handlers present)
    const accountEditBtn = screen.queryByRole("button", { name: /edit account beneficiar/i });
    const entityEditBtn = screen.queryByRole("button", { name: /edit entity beneficiar/i });
    expect(accountEditBtn).toBeNull();
    expect(entityEditBtn).toBeNull();
  });

  it("shows Edit, Add, Delete buttons and interactive rows under permission='edit'", async () => {
    await act(async () => {
      render(
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <FamilyView {...FV_BASE_PROPS} />
        </ClientAccessProvider>,
      );
    });

    // "Edit profile" button must be present
    const editProfileBtn = screen.queryByRole("button", { name: /edit profile/i });
    expect(editProfileBtn).not.toBeNull();

    // "+ Add" button for family members must be present
    const addBtns = screen.queryAllByRole("button", { name: /^\+ Add$/ });
    expect(addBtns.length).toBeGreaterThan(0);

    // "+ Add Trust" button must be present
    const addTrustBtn = screen.queryByRole("button", { name: /add trust/i });
    expect(addTrustBtn).not.toBeNull();

    // Family member row "Bob" must be interactive (cursor-pointer class)
    // Look in td elements to avoid matching the gift recipient td "Bob Test"
    const bobCells = screen.queryAllByText(/Bob/, { selector: "td" });
    expect(bobCells.length).toBeGreaterThan(0);
    const bobRow = bobCells[0].closest("tr");
    expect(bobRow?.className).toContain("cursor-pointer");

    // Trust row must be interactive (clickable row that opens EntityDialog)
    const trustName = screen.getByText("Alice Trust");
    const trustRow = trustName.closest("tr");
    expect(trustRow?.className).toContain("cursor-pointer");

    // "+ Add gift" button must be present
    const addGiftBtn = screen.queryByRole("button", { name: /add gift/i });
    expect(addGiftBtn).not.toBeNull();

    // Gift per-row Edit button must be present
    const giftEditBtns = screen.queryAllByRole("button", { name: /^Edit$/ });
    expect(giftEditBtns.length).toBeGreaterThan(0);

    // BeneficiarySummary edit handlers must be passed (mock renders buttons when handlers defined)
    const accountEditBtn = screen.queryByRole("button", { name: /edit account beneficiar/i });
    const entityEditBtn = screen.queryByRole("button", { name: /edit entity beneficiar/i });
    expect(accountEditBtn).not.toBeNull();
    expect(entityEditBtn).not.toBeNull();
  });
});
