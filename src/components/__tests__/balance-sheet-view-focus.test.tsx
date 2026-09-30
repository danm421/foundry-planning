// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE row's Net Worth dialog.
 *
 * With `focus` set the view must render only the dialog the page's own click
 * would open for that row, seeded with that row, and hand control back through
 * `onFocusClose` whenever that dialog goes away (cancel, save, delete) or never
 * could open — the row is missing, its kind isn't edited here, or the page
 * itself offers no editor for it ("unavailable") — or its editor is known to
 * write the base plan inside a scenario ("unsupported": a household business).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const submit = vi.fn();

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit, scenarioActive: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/solver",
}));

vi.mock("@/components/toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import BalanceSheetView, { type AccountRow, type LiabilityRow } from "@/components/balance-sheet-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { CategoryDefaults } from "@/components/forms/add-account-form";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

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

const CLIENT_OWNS = [{ kind: "family_member" as const, familyMemberId: "fm-client", percent: 1 }];

const BROKERAGE: AccountRow = {
  id: "acct-taxable",
  name: "Brokerage Account",
  category: "taxable",
  subType: "individual",
  owner: "client",
  value: "100000",
  basis: "80000",
  growthRate: null,
  owners: CLIENT_OWNS,
};

/** A top-level, household-owned business. The page edits it in BusinessDialog,
 *  whose saves bypass the scenario writer, so focus mode reports it unavailable. */
const BUSINESS: AccountRow = {
  id: "acct-biz",
  name: "Acme Widgets LLC",
  category: "business",
  subType: "llc",
  owner: "client",
  value: "500000",
  basis: "100000",
  growthRate: null,
  owners: CLIENT_OWNS,
};

/** A business's sub-account: shown only inside its business's row group. */
const BUSINESS_CASH: AccountRow = {
  id: "acct-biz-cash",
  name: "Acme Operating Cash",
  category: "cash",
  subType: "checking",
  owner: "client",
  value: "25000",
  basis: "25000",
  growthRate: null,
  parentAccountId: "acct-biz",
};

/** A trust-owned business sits in the Out of Estate panel, whose click opens
 *  the plain account dialog (a scenario-aware writer) — not BusinessDialog. */
const TRUST_BUSINESS: AccountRow = {
  id: "acct-trust-biz",
  name: "Gifted Holdings LLC",
  category: "business",
  subType: "llc",
  owner: "client",
  value: "300000",
  basis: "50000",
  growthRate: null,
  ownerEntityId: "ent-trust",
  owners: [{ kind: "entity", entityId: "ent-trust", percent: 1 }],
};

/** The page sends a policy click to the Insurance page instead of a dialog. */
const POLICY: AccountRow = {
  id: "acct-policy",
  name: "Whole Life Policy",
  category: "life_insurance",
  subType: "whole_life",
  owner: "client",
  value: "40000",
  basis: "0",
  growthRate: null,
};

const MORTGAGE: LiabilityRow = {
  id: "liab-mortgage",
  name: "Home Mortgage",
  balance: "300000",
  interestRate: "0.05",
  monthlyPayment: "2000",
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  termUnit: "annual",
  forgiveAtTermEnd: false,
  owners: CLIENT_OWNS,
};

/** Shown only inside the household business's row group. */
const BUSINESS_LOAN: LiabilityRow = {
  ...MORTGAGE,
  id: "liab-biz-loan",
  name: "Acme Equipment Loan",
  owners: undefined,
  parentAccountId: "acct-biz",
};

/** Its business is out of estate, so no row group ever shows it. */
const TRUST_BUSINESS_LOAN: LiabilityRow = {
  ...BUSINESS_LOAN,
  id: "liab-trust-biz-loan",
  name: "Gifted Holdings Note",
  parentAccountId: "acct-trust-biz",
};

const BASE_PROPS = {
  clientId: "c1",
  accounts: [BROKERAGE, BUSINESS, BUSINESS_CASH, TRUST_BUSINESS, POLICY],
  liabilities: [MORTGAGE, BUSINESS_LOAN, TRUST_BUSINESS_LOAN],
  entities: [{ id: "ent-trust", name: "Smith Family Trust", entityType: "trust" }],
  familyMembers: [{ id: "fm-client", role: "client" as const, firstName: "Alice" }],
  categoryDefaults: CATEGORY_DEFAULTS,
  ownerNames: { clientName: "Alice Test", spouseName: null },
};

function renderFocused(
  focus: EditorFocus,
  onFocusClose = vi.fn(),
  permission: "view" | "edit" = "edit",
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <BalanceSheetView {...BASE_PROPS} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
  return { ...utils, onFocusClose };
}

const dialog = (title: string) => within(screen.getByRole("dialog", { name: title }));

/** Every page-chrome landmark focus mode must leave out. */
function expectNoPageChrome() {
  expect(screen.queryByRole("heading", { name: "Assets" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Liabilities" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Out of Estate" })).toBeNull();
  expect(screen.queryByText("Net Worth")).toBeNull();
}

type Focused = { container: HTMLElement; onFocusClose: ReturnType<typeof vi.fn> };

/** Nothing opened: `onFocusClose(outcome)` once, and nothing rendered. */
async function expectNothingOpened(utils: Focused, outcome: "unavailable" | "unsupported") {
  await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));
  expect(utils.onFocusClose).toHaveBeenCalledWith(outcome);
  expect(utils.container).toBeEmptyDOMElement();
}
const expectUnavailable = (utils: Focused) => expectNothingOpened(utils, "unavailable");

beforeEach(() => {
  submit.mockReset();
  // The dialogs fetch side data on open (savings rules, allocations, cascade
  // dependents); an empty list satisfies every one of them.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Which dialog opens
// ---------------------------------------------------------------------------

describe("BalanceSheetView focus mode — which dialog opens", () => {
  it("account → the account dialog, pre-filled with that row, and nothing else", () => {
    renderFocused({ kind: "account", id: "acct-taxable" });

    expect(screen.getByRole("dialog", { name: "Edit Account" })).toBeTruthy();
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Brokerage Account");
    expect(screen.queryByRole("dialog", { name: "Edit Business" })).toBeNull();
    expectNoPageChrome();
  });

  it("a business's sub-account → the account dialog, as its row group opens it", () => {
    renderFocused({ kind: "account", id: "acct-biz-cash" });

    expect(screen.getByRole("dialog", { name: "Edit Account" })).toBeTruthy();
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Acme Operating Cash");
  });

  it("a trust-owned business → the account dialog, as the Out of Estate panel opens it", () => {
    renderFocused({ kind: "account", id: "acct-trust-biz" });

    expect(screen.getByRole("dialog", { name: "Edit Account" })).toBeTruthy();
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Gifted Holdings LLC");
    expect(screen.queryByRole("dialog", { name: "Edit Business" })).toBeNull();
  });

  it("liability → the liability dialog, pre-filled with that row", () => {
    renderFocused({ kind: "liability", id: "liab-mortgage" });

    expect(screen.getByRole("dialog", { name: "Edit Liability" })).toBeTruthy();
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Home Mortgage");
    expectNoPageChrome();
  });

  it("a business's sub-liability → the liability dialog, as its row group opens it", () => {
    renderFocused({ kind: "liability", id: "liab-biz-loan" });

    expect(screen.getByRole("dialog", { name: "Edit Liability" })).toBeTruthy();
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Acme Equipment Loan");
  });
});

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

describe("BalanceSheetView focus mode — unavailable", () => {
  it("a row that isn't there → onFocusClose(\"unavailable\") once, nothing rendered", async () => {
    const utils = renderFocused({ kind: "account", id: "gone" });

    await expectUnavailable(utils);

    // A parent re-render with fresh inline props must not close it again.
    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetView {...BASE_PROPS} focus={{ kind: "account", id: "gone" }} onFocusClose={utils.onFocusClose} />
      </ClientAccessProvider>,
    );
    expect(utils.onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("a kind this view doesn't edit → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "income", id: "acct-taxable" }));
  });

  it("a life-insurance policy → unavailable, as the page sends it to Insurance", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "acct-policy" }));
  });

  it("a sub-liability of an out-of-estate business → unavailable, as no row group shows it", async () => {
    await expectUnavailable(renderFocused({ kind: "liability", id: "liab-trust-biz-loan" }));
  });

  it("without edit permission → unavailable, as the page offers no editor either", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "acct-taxable" }, vi.fn(), "view"));
  });
});

// Ruling F-I2: rows whose editor is known to write the base plan inside a
// scenario report "unsupported" — the host shows no Details-page link, as the
// page carries the same bug.
describe("BalanceSheetView focus mode — unsupported", () => {
  // BusinessDialog's Details and Notes saves PUT the base account, bypassing the
  // scenario — from the Solver that would overwrite the base plan.
  it("a top-level household business → unsupported, never BusinessDialog", async () => {
    await expectNothingOpened(renderFocused({ kind: "account", id: "acct-biz" }), "unsupported");
  });

  it("without edit permission a household business is unavailable, like every row", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "acct-biz" }, vi.fn(), "view"));
  });
});

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe("BalanceSheetView focus mode — closing", () => {
  // A normal close carries no outcome at all — not even an explicit undefined.
  it.each([
    { label: "account", focus: { kind: "account" as const, id: "acct-taxable" }, title: "Edit Account" },
    { label: "liability", focus: { kind: "liability" as const, id: "liab-mortgage" }, title: "Edit Liability" },
  ])("cancelling the $label dialog calls onFocusClose()", ({ focus, title }) => {
    const { onFocusClose } = renderFocused(focus);
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(dialog(title).getByRole("button", { name: "Cancel" }));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  // Asking to delete opens a confirm ON TOP of the editor; handing control back
  // then would unmount the confirm with it.
  it.each([
    { label: "account", focus: { kind: "account" as const, id: "acct-taxable" }, title: "Edit Account", confirm: "Delete Account" },
    { label: "liability", focus: { kind: "liability" as const, id: "liab-mortgage" }, title: "Edit Liability", confirm: "Delete Liability" },
  ])("asking to delete from the $label dialog opens the confirm, not onFocusClose", ({ focus, title, confirm }) => {
    const { onFocusClose } = renderFocused(focus);

    fireEvent.click(dialog(title).getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog", { name: confirm })).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it("a confirmed account delete calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, status: 204 });
    const { onFocusClose } = renderFocused({ kind: "account", id: "acct-taxable" });

    fireEvent.click(dialog("Edit Account").getByRole("button", { name: "Delete" }));
    fireEvent.click(dialog("Delete Account").getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      { op: "remove", targetKind: "account", targetId: "acct-taxable" },
      expect.anything(),
    );
  });

  it("a successful account save calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, json: async () => ({ id: "acct-taxable" }) });
    const { onFocusClose } = renderFocused({ kind: "account", id: "acct-taxable" });

    fireEvent.submit(document.getElementById("add-account-form") as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "edit", targetKind: "account", targetId: "acct-taxable" }),
      expect.anything(),
    );
  });

  it("a successful liability save calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, json: async () => ({ id: "liab-mortgage" }) });
    const { onFocusClose } = renderFocused({ kind: "liability", id: "liab-mortgage" });

    fireEvent.submit(document.getElementById("add-liability-form") as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "edit", targetKind: "liability", targetId: "liab-mortgage" }),
      expect.anything(),
    );
  });
});
