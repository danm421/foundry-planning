// @vitest-environment jsdom
/**
 * The "Portfolio assets" KPI on Details → Net Worth.
 *
 * Bug: the KPI filtered with `isLiquid` from lib/account-groups/liquid-filter,
 * which answers "may this account join a savings/withdrawal group" and covers
 * only taxable/cash/retirement. Annuities and life-insurance cash value were
 * therefore missing from a KPI that carries the same name — and is meant to
 * carry the same value — as the cash-flow report's Portfolio Assets column
 * (engine `portfolioAssets.liquidTotal`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

const acct = (
  id: string,
  category: string,
  value: string,
  subType: string,
) => ({
  id,
  name: `${category} acct`,
  category: category as "taxable",
  subType,
  owner: "client",
  value,
  basis: value,
  growthRate: null,
});

// Distinct powers of ten so any single omission is legible in the total.
const ACCOUNTS = [
  acct("a-taxable", "taxable", "100000", "individual"),
  acct("a-cash", "cash", "20000", "checking"),
  acct("a-retirement", "retirement", "300000", "401k"),
  acct("a-annuity", "annuity", "40000", "other"),
  acct("a-life", "life_insurance", "5000", "whole_life"),
  // Not portfolio — net worth only.
  acct("a-re", "real_estate", "700000", "primary_residence"),
  acct("a-biz", "business", "800000", "operating"),
];

function renderView() {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "shared" }}>
      <BalanceSheetView
        clientId="test-client-id"
        accounts={ACCOUNTS}
        liabilities={[]}
        entities={[]}
        categoryDefaults={CATEGORY_DEFAULTS}
        ownerNames={{ clientName: "Alice Test", spouseName: null }}
      />
    </ClientAccessProvider>,
  );
}

/** The KPI tile's rendered dollar figure. The label is a <p> inside the tile
 *  <div>, so `closest("div")` IS the tile — walking up any further lands on the
 *  KPI grid and silently reads the neighbouring "Assets (in estate)" figure. */
function portfolioKpiValue(): string {
  const label = screen.getByText("Portfolio assets");
  // Read the value <p> directly. Matching /\$[\d,]+/ against the tile's
  // textContent instead swallows the leading digit of the subtitle that
  // immediately follows it ("$465,000" + "5 liquid accounts" → "$465,0005").
  return label.nextElementSibling?.textContent ?? "";
}

describe("BalanceSheetView — Portfolio assets KPI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("counts annuity and life-insurance cash value alongside taxable/cash/retirement", () => {
    renderView();
    // 100,000 + 20,000 + 300,000 + 40,000 + 5,000 = 465,000
    expect(portfolioKpiValue()).toBe("$465,000");
  });

  it("excludes real estate and business, which are net worth not portfolio", () => {
    renderView();
    // Would be $1,965,000 if RE + business leaked in.
    expect(portfolioKpiValue()).not.toBe("$1,965,000");
  });

  it("counts every portfolio account in the subtitle", () => {
    renderView();
    expect(screen.getByText("5 liquid accounts")).toBeTruthy();
  });
});
