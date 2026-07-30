// @vitest-environment jsdom
/**
 * The Add Asset category picker used to render in-flow under its trigger, so
 * any ancestor with `overflow-hidden` clipped it. The onboarding wizard's step
 * card does exactly that — advisors saw Taxable / Cash / Retirement and nothing
 * below. The menu is now portaled to <body>, so no ancestor can clip it.
 *
 * jsdom does no layout, so "not clipped" is asserted structurally: the menu
 * must NOT be a descendant of the overflow-hidden wrapper, and every addable
 * category must be present.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/onboarding/accounts",
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

/** Every category the menu offers — life insurance is created from the
 *  Insurance section, so it is deliberately absent. */
const EXPECTED_LABELS = [
  "Taxable",
  "Cash",
  "Retirement",
  "Annuity",
  "Real Estate",
  "Business",
  "Stock Options",
  "529 / Education",
  "Notes Receivable",
];

/** Stands in for the wizard step card, which clips its overflow. */
function renderInClippingCard() {
  return render(
    <div data-testid="clipping-card" className="overflow-hidden">
      <ClientAccessProvider value={{ permission: "edit", access: "shared" }}>
        <BalanceSheetView
          clientId="test-client-id"
          accounts={[]}
          liabilities={[]}
          entities={[]}
          categoryDefaults={CATEGORY_DEFAULTS}
          ownerNames={{ clientName: "Alice Test", spouseName: null }}
          embed="wizard"
          section="accounts"
        />
      </ClientAccessProvider>
    </div>,
  );
}

describe("BalanceSheetView Add Asset menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers every addable category", () => {
    renderInClippingCard();
    fireEvent.click(screen.getByRole("button", { name: /add asset/i }));

    const items = screen
      .getByRole("menu", { name: /add asset/i })
      .querySelectorAll("[role='menuitem']");
    expect(Array.from(items, (el) => el.textContent)).toEqual(EXPECTED_LABELS);
  });

  it("escapes the overflow-hidden ancestor that would clip it", () => {
    const { getByTestId } = renderInClippingCard();
    fireEvent.click(screen.getByRole("button", { name: /add asset/i }));

    const menu = screen.getByRole("menu", { name: /add asset/i });
    expect(getByTestId("clipping-card").contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("picking a category closes the menu", () => {
    renderInClippingCard();
    fireEvent.click(screen.getByRole("button", { name: /add asset/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Notes Receivable" }));

    expect(screen.queryByRole("menu", { name: /add asset/i })).toBeNull();
  });
});
