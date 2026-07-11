// @vitest-environment jsdom
/**
 * Tests for the linked-account indicator in BalanceSheetView.
 *
 * Accounts and liabilities whose balances are fed by an external integration
 * (Plaid today; Orion/Addepar/Black Diamond later) carry `linkedSource` and
 * render a small badge next to the name whose accessible label names the
 * source. Manually-entered rows leave `linkedSource` unset and render no badge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports (mirrors the 529 display test)
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
vi.mock("@/components/beneficiary-summary", () => ({ default: () => null }));

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
import BalanceSheetView, { type AccountRow, type LiabilityRow } from "@/components/balance-sheet-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { CategoryDefaults } from "@/components/forms/add-account-form";

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
  education_savings: "0.07",
};

const PLAID_ACCOUNT: AccountRow = {
  id: "acct-plaid",
  name: "Chase Brokerage",
  category: "taxable",
  subType: "individual",
  owner: "client",
  value: "100000",
  basis: "80000",
  linkedSource: "plaid",
  growthRate: null,
};

const ORION_ACCOUNT: AccountRow = {
  id: "acct-orion",
  name: "Orion Managed",
  category: "taxable",
  subType: "individual",
  owner: "client",
  value: "50000",
  basis: "40000",
  linkedSource: "orion",
  growthRate: null,
};

const MANUAL_ACCOUNT: AccountRow = {
  id: "acct-manual",
  name: "Manual Brokerage",
  category: "taxable",
  subType: "individual",
  owner: "client",
  value: "25000",
  basis: "25000",
  linkedSource: null,
  growthRate: null,
};

const PLAID_LIABILITY: LiabilityRow = {
  id: "liab-plaid",
  name: "Chase Card",
  balance: "5000",
  interestRate: "0",
  monthlyPayment: "0",
  startYear: 2024,
  startMonth: 1,
  termMonths: 12,
  termUnit: "annual",
  linkedSource: "plaid",
};

const MANUAL_LIABILITY: LiabilityRow = {
  id: "liab-manual",
  name: "Home Mortgage",
  balance: "300000",
  interestRate: "0.031",
  monthlyPayment: "0",
  startYear: 2024,
  startMonth: 1,
  termMonths: 360,
  termUnit: "monthly",
  linkedSource: null,
};

function renderView(props: {
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
}) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "shared" }}>
      <BalanceSheetView
        clientId="test-client-id"
        accounts={props.accounts}
        liabilities={props.liabilities}
        entities={[]}
        categoryDefaults={CATEGORY_DEFAULTS}
        ownerNames={{ clientName: "Alice Test", spouseName: null }}
      />
    </ClientAccessProvider>,
  );
}

describe("BalanceSheetView linked-account indicator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("badges a Plaid-linked liability and leaves a manual one bare", () => {
    // Liabilities render without expanding a category group.
    renderView({ accounts: [], liabilities: [PLAID_LIABILITY, MANUAL_LIABILITY] });

    expect(screen.getByText("Chase Card")).toBeTruthy();
    expect(screen.getByText("Home Mortgage")).toBeTruthy();

    const badges = screen.getAllByRole("img", { name: /Linked via|Synced from/ });
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute("aria-label")).toBe("Linked via Plaid");
  });

  it("badges a Plaid account after expanding its category, not the manual sibling", () => {
    renderView({ accounts: [PLAID_ACCOUNT, MANUAL_ACCOUNT], liabilities: [] });

    // Categories start collapsed — open Taxable to reveal the rows.
    fireEvent.click(screen.getByRole("button", { name: /taxable/i }));

    expect(screen.getByText("Chase Brokerage")).toBeTruthy();
    expect(screen.getByText("Manual Brokerage")).toBeTruthy();

    const badges = screen.getAllByRole("img", { name: /Linked via|Synced from/ });
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute("aria-label")).toBe("Linked via Plaid");
  });

  it("labels an Orion-synced account 'Synced from Orion'", () => {
    renderView({ accounts: [ORION_ACCOUNT], liabilities: [] });

    fireEvent.click(screen.getByRole("button", { name: /taxable/i }));

    expect(screen.getByRole("img", { name: "Synced from Orion" })).toBeTruthy();
  });
});
