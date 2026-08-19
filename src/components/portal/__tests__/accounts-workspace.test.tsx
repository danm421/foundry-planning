// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Canvas is unavailable in jsdom.
vi.mock("../networth-trend-chart", () => ({ NetWorthTrendChart: () => <div data-testid="trend" /> }));
// Plaid Link pulls in a dynamic browser-only bundle. Surface `scope` so the
// header's two entry points stay distinguishable in tests.
vi.mock("../plaid-link-button-dynamic", () => ({
  PlaidLinkButton: ({ scope }: { scope?: string }) => (
    <button type="button" data-scope={scope}>
      Link Account
    </button>
  ),
}));
vi.mock("../plaid-consent-notice", () => ({ PlaidConsentNotice: () => null }));
vi.mock("../plaid-account-picker", () => ({ PlaidAccountPicker: () => null }));

type FetchDouble = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
const defaultPortalFetch: FetchDouble = () =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({} as unknown) });
const portalFetch = vi.fn<FetchDouble>(defaultPortalFetch);
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
    holdingsAccountIds: ["a2"],
    editEnabled: true,
    ...over,
  };
}

beforeEach(() => {
  // mockClear keeps the last mockImplementation, so a test that stubs a
  // response would silently answer every later test's fetches too.
  portalFetch.mockReset();
  portalFetch.mockImplementation(defaultPortalFetch);
});

/**
 * A rail row, scoped to the nav. An account card's accessible name carries its
 * subtitle ("Cash · checking"), so an unscoped `/Cash/` button query matches the
 * card as well as the rail row.
 */
function railButton(name: RegExp): HTMLElement {
  const nav = within(document.body).getByRole("navigation", { name: "Account categories" });
  return within(nav).getByRole("button", { name });
}

/** The portalFetch call to `url`, so a write's method and body can be inspected. */
function callTo(url: string): [string, RequestInit] {
  const calls = portalFetch.mock.calls as unknown as [string, RequestInit][];
  const call = calls.find((c) => c[0] === url);
  if (!call) throw new Error(`no portalFetch call to ${url}`);
  return call;
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
    expect(getByRole("button", { name: "Activity" })).toBeTruthy();
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

  // Plaid can't require one product that fits every account type, so banking and
  // investment links are separate tokens. Losing either button silently strands
  // half a client's accounts — the bug this pair replaced.
  it("offers both a banking and an investments link entry point", () => {
    const { container } = render(<AccountsWorkspace dto={dto()} />);
    const scopes = Array.from(container.querySelectorAll("button[data-scope]")).map((b) =>
      b.getAttribute("data-scope"),
    );
    expect(scopes).toEqual(["banking", "investments"]);
  });

  it("hides every write affordance when editEnabled is false", () => {
    const { queryByRole, getByText } = render(<AccountsWorkspace dto={dto({ editEnabled: false })} />);
    expect(queryByRole("button", { name: "Add Account or Loan" })).toBeNull();
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

  it("omits the Plaid-owned fields from a linked account's PUT body", async () => {
    const { getByText, getByRole } = render(
      <AccountsWorkspace
        dto={dto({ ownersByAccountId: { a2: [{ familyMemberId: "fm1", entityId: null, percent: "1" }] } })}
      />,
    );
    fireEvent.click(getByText("Rollover IRA"));
    fireEvent.click(getByRole("button", { name: "Edit" }));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });

    const [, init] = callTo("/api/portal/accounts/a2");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body));
    // Plaid owns these on a linked row — sending them earns a 400 from the PUT route.
    expect(body).not.toHaveProperty("value");
    expect(body).not.toHaveProperty("last4");
    expect(body.name).toBe("Rollover IRA");
    expect(body.category).toBe("retirement");
    expect(body.owners).toEqual([{ kind: "family_member", familyMemberId: "fm1", percent: 1 }]);
  });

  it("PUTs a manual account in full and closes the panel on success", async () => {
    const { getByText, getByRole, queryByRole, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    fireEvent.click(getByRole("button", { name: "Edit" }));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });

    const [, init] = callTo("/api/portal/accounts/a1");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body));
    // The strip is conditional: a manual row still sends what Plaid would own.
    expect(body.value).toBe("10000");
    expect(body.last4).toBeNull();
    // Post-success continuation: the form closed back to the card list.
    expect(queryByRole("button", { name: "Save" })).toBeNull();
    expect(container.textContent).toContain("Rollover IRA");
  });

  it("omits the Plaid-owned balance from a linked debt's PUT body", async () => {
    const base = dto();
    const { getByText, getByRole } = render(
      <AccountsWorkspace
        dto={dto({ debts: [{ ...base.debts[0], isPlaidLinked: true, ownerFmIds: ["fm1"] }] })}
      />,
    );
    fireEvent.click(getByText("Home Loan"));
    fireEvent.click(getByRole("button", { name: "Edit" }));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });

    const [, init] = callTo("/api/portal/liabilities/l1");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty("balance");
    expect(body.name).toBe("Home Loan");
    expect(body.liabilityType).toBe("mortgage");
    expect(body.owners).toEqual([{ kind: "family_member", familyMemberId: "fm1", percent: 1 }]);
  });

  // ---- Adding a loan ----

  it("POSTs a new account when the add panel is left on Account", async () => {
    const { getByRole, getByLabelText } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByRole("button", { name: "Add Account or Loan" }));
    fireEvent.change(getByLabelText("Name"), { target: { value: "New Savings" } });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });

    const [, init] = callTo("/api/portal/accounts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).category).toBe("cash");
  });

  it("switches the add panel to the loan form and POSTs to the liabilities route", async () => {
    const { getByRole, getByLabelText, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByRole("button", { name: "Add Account or Loan" }));
    fireEvent.change(getByLabelText("What are you adding?"), { target: { value: "debt" } });

    // The loan form is showing: its Type select replaced the account Category one.
    expect(getByRole("option", { name: "Auto loan" })).toBeTruthy();
    expect(container.textContent).not.toContain("Sub-type");

    fireEvent.change(getByLabelText("Name"), { target: { value: "Car Loan" } });
    fireEvent.change(getByLabelText("Type"), { target: { value: "auto" } });
    fireEvent.change(getByLabelText("Balance"), { target: { value: "18500" } });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });

    const [, init] = callTo("/api/portal/liabilities");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.name).toBe("Car Loan");
    expect(body.liabilityType).toBe("auto");
    expect(body.balance).toBe("18500");
    // Pre-checked from the primary family member, same as the account add form.
    expect(body.owners).toEqual([{ kind: "family_member", familyMemberId: "fm1", percent: 1 }]);
  });

  it("keeps the loan add form editable — nothing is Plaid-locked on a new row", () => {
    const { getByRole, getByLabelText, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByRole("button", { name: "Add Account or Loan" }));
    fireEvent.change(getByLabelText("What are you adding?"), { target: { value: "debt" } });
    expect(container.textContent).not.toContain("syncs from your institution");
    expect(getByLabelText("Balance").tagName).toBe("INPUT");
  });

  it("shows the empty state with no accounts and no debts", () => {
    const { container } = render(
      <AccountsWorkspace dto={dto({ assets: [], debts: [], netWorth: { assets: 0, debt: 0, netWorth: 0 } })} />,
    );
    expect(container.textContent).toContain("No accounts yet");
  });

  it("disables Save, Cancel, and Add while an account save is in flight", async () => {
    const { getByText, getByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    fireEvent.click(getByRole("button", { name: "Edit" }));

    // The PUT never resolves during this test — the window it protects must
    // stay observable so a second click can't double-submit.
    let resolveSave!: (v: { ok: boolean; status: number; json: () => Promise<Record<string, unknown>> }) => void;
    const deferred = new Promise<{ ok: boolean; status: number; json: () => Promise<Record<string, unknown>> }>((resolve) => {
      resolveSave = resolve;
    });
    portalFetch.mockImplementationOnce(() => deferred);

    fireEvent.click(getByRole("button", { name: "Save" }));

    // Mid-flight: the PUT has fired but not resolved. Every mutating control
    // reachable from this view must be locked.
    expect(getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(getByRole("button", { name: "Add Account or Loan" })).toBeDisabled();

    await act(async () => {
      resolveSave({ ok: true, status: 200, json: async () => ({}) });
    });
  });

  it("disables Edit, Delete, and Add while an account delete is in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getByText, getByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));

    // The DELETE never resolves during this test — same reasoning as the save case.
    let resolveDelete!: (v: { ok: boolean; status: number; json: () => Promise<Record<string, unknown>> }) => void;
    const deferred = new Promise<{ ok: boolean; status: number; json: () => Promise<Record<string, unknown>> }>((resolve) => {
      resolveDelete = resolve;
    });
    portalFetch.mockImplementationOnce(() => deferred);

    fireEvent.click(getByRole("button", { name: "Delete" }));

    // Mid-flight: the DELETE has fired but not resolved.
    expect(getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(getByRole("button", { name: "Add Account or Loan" })).toBeDisabled();

    await act(async () => {
      resolveDelete({ ok: true, status: 200, json: async () => ({}) });
    });
  });
  // ---- Holdings tab ----

  it("shows the account's positions under Holdings, largest-first from the route", async () => {
    portalFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url.startsWith("/api/portal/accounts/a2/holdings")
              ? {
                  holdings: [
                    { ticker: "VTI", name: "Vanguard Total Stock", shares: 500, price: 240, marketValue: 120_000, costBasis: 90_000 },
                    { ticker: null, name: "Treasury 4.25% 2030", shares: 25_000, price: 99.5, marketValue: 24_875, costBasis: null },
                  ],
                }
              : {},
          ),
      }),
    );
    const { getByText, getByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Rollover IRA"));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Holdings" }));
    });
    const table = getByRole("table", { name: "Holdings" });
    expect(
      within(table).getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Holding", "Shares", "Price", "Cost basis", "Value"]);

    // Cell-by-cell, so a value landing in the wrong column is a failure rather
    // than a substring that still happens to appear somewhere in the table.
    const rows = within(table).getAllByRole("row").slice(1); // drop the header row
    const cellValues = (row: HTMLElement) =>
      within(row).getAllByRole("cell").map((td) => td.textContent);
    expect(rows[0].textContent).toContain("VTI");
    // The ticker takes the first line, so the name repeats beneath it.
    expect(rows[0].textContent).toContain("Vanguard Total Stock");
    expect(cellValues(rows[0])).toEqual([
      "500",
      "$240.00",
      "$90,000",
      "$120,000",
    ]);
    // Untickered positions fall back to their name, and a price to the cent
    // keeps a bond at 99.5 from reading as "$100".
    expect(rows[1].textContent).toContain("Treasury 4.25% 2030");
    expect(cellValues(rows[1])).toEqual([
      "25,000",
      "$99.50",
      "—",
      "$24,875",
    ]);
    expect(portalFetch).toHaveBeenCalledWith("/api/portal/accounts/a2/holdings");
  });

  it("lists a bank account as cash without asking the holdings route", async () => {
    const { getByText, getByRole } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Joint Checking"));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Holdings" }));
    });
    const list = getByRole("list", { name: "Holdings" });
    expect(list.textContent).toContain("Cash");
    expect(list.textContent).toContain("$10,000");
    // A checking account holds one thing; querying positions for it is waste.
    const urls = (portalFetch.mock.calls as unknown as [string][]).map((c) => c[0]);
    expect(urls.some((u) => u.includes("/holdings"))).toBe(false);
  });

  it("offers no Holdings tab for an account with nothing in it", () => {
    // Same retirement account, but the loader saw no positions — e.g. the
    // advisor switched the Investments section off.
    const { getByText, queryByRole, container } = render(
      <AccountsWorkspace dto={dto({ holdingsAccountIds: [] })} />,
    );
    fireEvent.click(getByText("Rollover IRA"));
    expect(queryByRole("button", { name: "Holdings" })).toBeNull();
    expect(container.textContent).toContain("Recent activity");
  });

  it("does not carry the Holdings tab over to the next account opened", async () => {
    const { getByText, getByRole, queryByRole, container } = render(
      <AccountsWorkspace dto={dto({ holdingsAccountIds: [] })} />,
    );
    // a1 is cash, so it has the tab; a2 now has neither positions nor cash.
    fireEvent.click(getByText("Joint Checking"));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Holdings" }));
    });
    fireEvent.click(getByRole("button", { name: /Back/ }));
    fireEvent.click(getByText("Rollover IRA"));
    expect(queryByRole("button", { name: "Holdings" })).toBeNull();
    // Falls back to activity rather than rendering an empty body.
    expect(container.textContent).toContain("Recent activity");
  });
  // ---- Activity states ----
  // The three fallbacks the tab renders instead of a transaction list. Untested
  // before the fetch was factored into one hook; pinned here so the shared hook
  // cannot quietly lose a branch.

  it("tells an advisor when the client keeps transactions private", async () => {
    portalFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }),
    );
    const { getByText, container } = render(<AccountsWorkspace dto={dto()} />);
    await act(async () => {
      fireEvent.click(getByText("Joint Checking"));
    });
    expect(container.textContent).toContain("The client keeps transactions private.");
  });

  it("says so when recent activity fails to load for any other reason", async () => {
    portalFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );
    const { getByText, container } = render(<AccountsWorkspace dto={dto()} />);
    await act(async () => {
      fireEvent.click(getByText("Joint Checking"));
    });
    expect(container.textContent).toContain("Couldn’t load recent activity.");
    expect(container.textContent).not.toContain("private");
  });

  it("says so when holdings fail to load", async () => {
    portalFetch.mockImplementation((url: string) =>
      url.includes("/holdings")
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : defaultPortalFetch(url),
    );
    const { getByText, getByRole, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Rollover IRA"));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Holdings" }));
    });
    expect(container.textContent).toContain("Couldn’t load holdings.");
  });

  it("reports an empty account rather than an endless skeleton", async () => {
    const { getByText, getByRole, container } = render(<AccountsWorkspace dto={dto()} />);
    fireEvent.click(getByText("Rollover IRA"));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Holdings" }));
    });
    expect(container.textContent).toContain("No holdings for this account yet.");
  });
});
