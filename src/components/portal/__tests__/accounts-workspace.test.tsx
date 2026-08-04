// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Canvas is unavailable in jsdom.
vi.mock("../networth-trend-chart", () => ({ NetWorthTrendChart: () => <div data-testid="trend" /> }));
// Plaid Link pulls in a dynamic browser-only bundle.
vi.mock("../plaid-link-button-dynamic", () => ({ PlaidLinkButton: () => <button type="button">Link Account</button> }));
vi.mock("../plaid-consent-notice", () => ({ PlaidConsentNotice: () => null }));
vi.mock("../plaid-account-picker", () => ({ PlaidAccountPicker: () => null }));

const portalFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
vi.mock("../portal-mode-context", () => ({
  usePortalFetch: () => portalFetch,
  usePortalMode: () => ({ mode: "client", clientId: "c1" }),
}));

import { AccountsWorkspace } from "../accounts-workspace";
import type { AccountsPageDTO } from "@/lib/portal/load-accounts-page";

function dto(over: Partial<AccountsPageDTO> = {}): AccountsPageDTO {
  return {
    assets: [
      { id: "a1", name: "Joint Checking", category: "cash", subType: "checking", last4: null, value: 10_000, isPlaidLinked: false },
      { id: "a2", name: "Rollover IRA", category: "retirement", subType: "traditional_ira", last4: null, value: 965_186, isPlaidLinked: true },
    ],
    debts: [
      { id: "l1", name: "Home Loan", balance: 125_000, rawBalance: 125_000, liabilityType: "mortgage", aprPercentage: null, statementBalance: null, minimumPayment: null, nextPaymentDueDate: null, isPlaidLinked: false, ownerFmIds: [], ownerEntityIds: [] },
    ],
    netWorth: { assets: 975_186, debt: 125_000, netWorth: 850_186 },
    series: [],
    asOfDate: "2026-08-03",
    familyMembers: [{ id: "fm1", firstName: "Pat", lastName: "Client", role: "client" }],
    trustEntities: [],
    ownersByAccountId: { a1: [{ familyMemberId: "fm1", entityId: null, percent: "1" }] },
    editEnabled: true,
    ...over,
  };
}

beforeEach(() => portalFetch.mockClear());

/**
 * A rail row, scoped to the nav. An account card's accessible name carries its
 * subtitle ("Cash · checking"), so an unscoped `/Cash/` button query matches the
 * card as well as the rail row.
 */
function railButton(name: RegExp): HTMLElement {
  const nav = within(document.body).getByRole("navigation", { name: "Account categories" });
  return within(nav).getByRole("button", { name });
}

describe("AccountsWorkspace", () => {
  it("defaults to Total Net Worth: every account renders", () => {
    const { container } = render(<AccountsWorkspace dto={dto()} />);
    expect(container.textContent).toContain("Joint Checking");
    expect(container.textContent).toContain("Rollover IRA");
    expect(container.textContent).toContain("Home Loan");
  });

  it("filters to one category when a rail row is selected", () => {
    const { container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(railButton(/Cash/));
    expect(container.textContent).toContain("Joint Checking");
    expect(container.textContent).not.toContain("Rollover IRA");
    expect(container.textContent).not.toContain("Home Loan");
  });

  it("returns to the full list when Total Net Worth is reselected", () => {
    const { container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(railButton(/Cash/));
    fireEvent.click(railButton(/Total Net Worth/));
    expect(container.textContent).toContain("Rollover IRA");
  });

  it("drills into an account and back again", () => {
    const { getByText, getByRole, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    // Detail replaces the list — the sibling account is gone.
    expect(container.textContent).not.toContain("Rollover IRA");
    expect(container.textContent).toContain("Recent activity");
    fireEvent.click(getByRole("button", { name: /Back/ }));
    expect(container.textContent).toContain("Rollover IRA");
  });

  it("drilling from a category returns to that category, not the default", () => {
    const { getByRole, getByText, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(railButton(/Cash/));
    fireEvent.click(getByText("Joint Checking"));
    fireEvent.click(getByRole("button", { name: /Back/ }));
    expect(container.textContent).toContain("Joint Checking");
    expect(container.textContent).not.toContain("Rollover IRA");
  });

  it("offers Delete on a manual account but not a Plaid-linked one", () => {
    const { getByText, getByRole, queryByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    expect(getByRole("button", { name: "Delete" })).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /Back/ }));
    fireEvent.click(getByText("Rollover IRA"));
    expect(queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("hides every write affordance when editEnabled is false", () => {
    const { queryByRole, getByText } = render(<AccountsWorkspace dto={dto({ editEnabled: false })} />);
    expect(queryByRole("button", { name: "Add Account" })).toBeNull();
    expect(queryByRole("button", { name: /Link Account/ })).toBeNull();
    fireEvent.click(getByText("Joint Checking"));
    expect(queryByRole("button", { name: "Edit" })).toBeNull();
    expect(queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("DELETEs through portalFetch after confirmation", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getByText, getByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    fireEvent.click(getByRole("button", { name: "Delete" }));
    expect(portalFetch).toHaveBeenCalledWith("/api/portal/accounts/a1", { method: "DELETE" });
  });

  it("does not DELETE when the confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByText, getByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    fireEvent.click(getByRole("button", { name: "Delete" }));
    // The open detail panel fetches its own recent activity, so assert the
    // absence of the DELETE rather than the absence of all portal traffic.
    expect(portalFetch).not.toHaveBeenCalledWith("/api/portal/accounts/a1", { method: "DELETE" });
  });

  it("shows the empty state with no accounts and no debts", () => {
    const { container } = render(
      <AccountsWorkspace dto={dto({ assets: [], debts: [], netWorth: { assets: 0, debt: 0, netWorth: 0 } })} />,
    );
    expect(container.textContent).toContain("No accounts yet");
  });
});
