// @vitest-environment jsdom
/**
 * TDD tests for 529 / education_savings display in BalanceSheetView.
 *
 * 529 accounts are out-of-estate (completed gifts under §529) but must still
 * be visible and editable where the advisor added them: as a "529 / Education"
 * category group in the Assets card, tagged "Out of estate" and excluded from
 * the in-estate Assets total / Net Worth. They must NOT also appear in the
 * amber Out of Estate box (that box is for trust/entity-held assets).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports (mirrors readonly-gating test)
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
import BalanceSheetView from "@/components/balance-sheet-view";
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

const TAXABLE_ACCOUNT = {
  id: "acct-taxable",
  name: "Brokerage Account",
  category: "taxable" as const,
  subType: "individual",
  owner: "client",
  value: "100000",
  basis: "80000",
  growthRate: null,
};

const EDU_529_A = {
  id: "acct-529-a",
  name: "Bright Start 529",
  category: "education_savings" as const,
  subType: "529",
  owner: "client",
  value: "15000",
  basis: "12000",
  growthRate: null,
  beneficiaryDisplayName: "Aiden Sample",
};

const EDU_529_B = {
  id: "acct-529-b",
  name: "ScholarShare 529",
  category: "education_savings" as const,
  subType: "529",
  owner: "client",
  value: "5000",
  basis: "5000",
  growthRate: null,
  beneficiaryDisplayName: null,
};

const BASE_PROPS = {
  clientId: "test-client-id",
  accounts: [TAXABLE_ACCOUNT, EDU_529_A, EDU_529_B],
  liabilities: [],
  entities: [],
  categoryDefaults: CATEGORY_DEFAULTS,
  ownerNames: { clientName: "Alice Test", spouseName: null },
};

function renderView() {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "shared" }}>
      <BalanceSheetView {...BASE_PROPS} />
    </ClientAccessProvider>,
  );
}

describe("BalanceSheetView 529 / education_savings display", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders a 529 / Education group in the Assets card with subtotal and Out of estate tag", () => {
    renderView();

    const groupToggle = screen.getByRole("button", { name: /529 \/ Education/ });
    expect(groupToggle).toBeTruthy();
    // Subtotal = 15,000 + 5,000
    expect(groupToggle.textContent).toContain("$20,000");
    expect(groupToggle.textContent).toMatch(/out of estate/i);
  });

  it("expanding the group shows each 529 with its beneficiary", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /529 \/ Education/ }));

    expect(screen.getByText("Bright Start 529")).toBeTruthy();
    expect(screen.getByText(/Aiden Sample/)).toBeTruthy();
    expect(screen.getByText("ScholarShare 529")).toBeTruthy();
    expect(screen.getByText(/Unnamed beneficiary/)).toBeTruthy();
  });

  it("excludes 529 value from the in-estate Assets total and Net Worth KPI", () => {
    renderView();

    // Assets panel total and Assets (in estate) KPI = taxable only
    expect(screen.getAllByText(/Total \$100,000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Total \$120,000/)).toBeNull();
  });

  it("does not render 529s in the amber Out of Estate section", () => {
    renderView();

    // No entity/trust-held assets → the Out of Estate section should be absent
    expect(screen.queryByText(/^Out of Estate$/)).toBeNull();
    expect(screen.queryByText(/— 529 Plan/)).toBeNull();
  });
});
