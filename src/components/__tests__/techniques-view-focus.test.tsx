// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE row's Techniques dialog.
 *
 * With `focus` set the view must render only the form the page's own Edit
 * button would open for that row, seeded with that row, and hand control back
 * through `onFocusClose` whenever that form goes away (cancel, save) or never
 * could open — the row is missing, its kind isn't edited here, the advisor
 * has view-only access.
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

const submit = vi.fn();

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit, scenarioActive: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c-1/solver",
}));

// The page's projected-net preview and the transaction dialog's projected
// hints both run the engine; neither is under test here.
vi.mock("@/engine", () => ({ runProjection: () => [] }));

import TechniquesView, {
  type AssetTransactionRow,
  type TechniquesViewProps,
} from "@/components/techniques-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BUNDLE = "00000000-0000-4000-8000-00000000000a";

function txn(over: Partial<AssetTransactionRow> & { id: string; name: string }): AssetTransactionRow {
  return {
    type: "sell",
    year: 2030,
    accountId: null,
    purchaseTransactionId: null,
    businessAccountId: null,
    bundleId: null,
    fractionSold: null,
    overrideSaleValue: null,
    overrideBasis: null,
    transactionCostPct: null,
    transactionCostFlat: null,
    proceedsAccountId: null,
    qualifiesForHomeSaleExclusion: null,
    assetName: null,
    assetCategory: null,
    assetSubType: null,
    purchasePrice: null,
    growthRate: null,
    basis: null,
    fundingAccountId: null,
    mortgageAmount: null,
    mortgageRate: null,
    mortgageTermMonths: null,
    annualPropertyTax: null,
    propertyTaxGrowthRate: null,
    propertyTaxGrowthSource: null,
    ...over,
  };
}

const PROPS: TechniquesViewProps = {
  clientId: "c-1",
  rothConversions: [
    {
      id: "rc-1",
      name: "Bracket Fill Conversion",
      destinationAccountId: "acc-roth",
      sourceAccountIds: ["acc-trad"],
      conversionType: "fixed_amount",
      fixedAmount: "50000",
      fillUpBracket: null,
      startYear: 2028,
      startYearRef: null,
      endYear: 2032,
      endYearRef: null,
      indexingRate: "0",
      inflationStartYear: null,
      irmaaCapTier: null,
    },
  ],
  transfers: [
    {
      id: "tr-1",
      name: "Brokerage Sweep",
      sourceAccountId: "acc-brokerage",
      targetAccountId: "acc-cash",
      amount: "20000",
      mode: "one_time",
      startYear: 2029,
      startYearRef: null,
      endYear: null,
      endYearRef: null,
      growthRate: "0",
      schedules: [],
    },
  ],
  reinvestments: [
    {
      id: "ri-1",
      name: "Glide Path Switch",
      pickedAccountIds: ["acc-brokerage"],
      groupKeys: [],
      year: 2031,
      yearRef: null,
      targetType: "model_portfolio",
      realizeTaxesOnSwitch: false,
      // This row's own detail fields, as the loader supplies them.
      modelPortfolioId: "mp-1",
      customGrowthRate: null,
      customPctOrdinaryIncome: null,
      customPctLtCapitalGains: null,
      customPctQualifiedDividends: null,
      customPctTaxExempt: null,
    },
  ],
  relocations: [{ id: "rl-1", name: "Move to Florida", year: 2033, destinationState: "FL" }],
  assetTransactions: [
    txn({ id: "tx-sell", name: "Downsize — Sell Oak Ave", accountId: "acc-house", bundleId: BUNDLE }),
    txn({
      id: "tx-buy",
      name: "Downsize — Buy Condo",
      type: "buy",
      bundleId: BUNDLE,
      assetName: "Condo",
      assetCategory: "real_estate",
      assetSubType: "primary_residence",
      purchasePrice: "600000",
    }),
  ],
  accounts: [
    { id: "acc-trad", name: "Alice Traditional IRA", category: "retirement", subType: "traditional_ira", ownerFamilyMemberId: "fm-1" },
    { id: "acc-roth", name: "Alice Roth IRA", category: "retirement", subType: "roth_ira", ownerFamilyMemberId: "fm-1" },
    { id: "acc-brokerage", name: "Joint Brokerage", category: "taxable", subType: "joint" },
    { id: "acc-cash", name: "Household Checking", category: "cash", subType: "checking" },
    { id: "acc-house", name: "Oak Ave", category: "real_estate", subType: "primary_residence", value: 900000 },
  ],
  liabilities: [],
  businesses: [],
  modelPortfolios: [{ id: "mp-1", name: "Balanced 60/40", growthRate: 0.06 }],
};

function renderFocused(
  focus: EditorFocus,
  onFocusClose = vi.fn(),
  permission: "view" | "edit" = "edit",
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <TechniquesView {...PROPS} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
  return { ...utils, onFocusClose };
}

const dialog = (title: string) => within(screen.getByRole("dialog", { name: title }));

/** The transfer form is a bare overlay, not a DialogShell — find it by its heading. */
const transferForm = () =>
  screen.getByRole("heading", { name: "Edit Transfer" }).closest("form") as HTMLFormElement;

const inputValue = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

/** Every section header focus mode must leave out. */
function expectNoPageChrome() {
  for (const title of ["Roth Conversions", "Transfers", "Reinvestments", "Relocation", "Asset Transactions"]) {
    expect(screen.queryByRole("heading", { name: title })).toBeNull();
  }
}

async function expectUnavailable(utils: { container: HTMLElement; onFocusClose: ReturnType<typeof vi.fn> }) {
  await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));
  expect(utils.onFocusClose).toHaveBeenCalledWith("unavailable");
  expect(utils.container).toBeEmptyDOMElement();
}

type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "status" | "json">>;
const fetchMock = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => [] }));

beforeEach(() => {
  submit.mockReset();
  fetchMock.mockClear();
  // The transaction form fetches its projected hints; an empty list will do.
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Which form opens
// ---------------------------------------------------------------------------

describe("TechniquesView focus mode — which form opens", () => {
  it("roth_conversion → the Roth conversion form, pre-filled with that row, and nothing else", () => {
    renderFocused({ kind: "roth_conversion", id: "rc-1" });

    expect(screen.getByRole("dialog", { name: "Edit Roth Conversion" })).toBeTruthy();
    expect(inputValue("rc-name")).toBe("Bracket Fill Conversion");
    expectNoPageChrome();
  });

  it("transfer → the transfer form, pre-filled with that row, and nothing else", () => {
    renderFocused({ kind: "transfer", id: "tr-1" });

    expect(within(transferForm()).getByDisplayValue("Brokerage Sweep")).toBeTruthy();
    expectNoPageChrome();
  });

  it("reinvestment → the reinvestment form, pre-filled with that row, and nothing else", () => {
    renderFocused({ kind: "reinvestment", id: "ri-1" });

    expect(screen.getByRole("dialog", { name: "Edit Reinvestment" })).toBeTruthy();
    expect(inputValue("reinvestment-name")).toBe("Glide Path Switch");
    expect((screen.getByLabelText(/model portfolio/i) as HTMLSelectElement).value).toBe("mp-1");
    expectNoPageChrome();
  });

  it("relocation → the relocation form, pre-filled with that row, and nothing else", () => {
    renderFocused({ kind: "relocation", id: "rl-1" });

    expect(screen.getByRole("dialog", { name: "Edit Relocation" })).toBeTruthy();
    expect(inputValue("relocation-name")).toBe("Move to Florida");
    expectNoPageChrome();
  });

  it("asset_transaction → the transaction form, holding the leg's WHOLE bundle as the page opens it", () => {
    // Focus names one leg; the page's Edit on that leg opens every leg.
    renderFocused({ kind: "asset_transaction", id: "tx-buy" });

    const tx = dialog("Edit Transaction");
    expect(tx.getByRole("button", { name: "Remove Oak Ave" })).toBeTruthy();
    expect(tx.getByRole("button", { name: "Remove Condo" })).toBeTruthy();
    expectNoPageChrome();
  });

  it("does not load the page's projected-net preview, which only its table shows", async () => {
    renderFocused({ kind: "relocation", id: "rl-1" });

    // Let any mount effect's fetch go out before asserting none did.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Edit Relocation" })).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("projection-data"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

describe("TechniquesView focus mode — unavailable", () => {
  it("a row that isn't there → onFocusClose(\"unavailable\") once, nothing rendered", async () => {
    const utils = renderFocused({ kind: "transfer", id: "gone" });

    await expectUnavailable(utils);

    // A parent re-render with fresh inline props must not close it again.
    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TechniquesView {...PROPS} focus={{ kind: "transfer", id: "gone" }} onFocusClose={utils.onFocusClose} />
      </ClientAccessProvider>,
    );
    expect(utils.onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("a kind this view doesn't edit → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "acc-brokerage" }));
  });

  it("an id that belongs to another kind → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "transfer", id: "rc-1" }));
  });

  it("a reinvestment id that isn't there → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "reinvestment", id: "gone" }));
  });

  it("without edit permission → unavailable, as the page offers no Edit button either", async () => {
    await expectUnavailable(renderFocused({ kind: "roth_conversion", id: "rc-1" }, vi.fn(), "view"));
  });
});

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe("TechniquesView focus mode — closing", () => {
  // A normal close carries no outcome at all — not even an explicit undefined.
  it.each([
    { kind: "roth_conversion" as const, id: "rc-1", title: "Edit Roth Conversion" },
    { kind: "reinvestment" as const, id: "ri-1", title: "Edit Reinvestment" },
    { kind: "relocation" as const, id: "rl-1", title: "Edit Relocation" },
    { kind: "asset_transaction" as const, id: "tx-sell", title: "Edit Transaction" },
  ])("cancelling the $kind form calls onFocusClose()", ({ kind, id, title }) => {
    const { onFocusClose } = renderFocused({ kind, id });
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(dialog(title).getByRole("button", { name: "Cancel" }));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("cancelling the transfer form calls onFocusClose()", () => {
    const { onFocusClose } = renderFocused({ kind: "transfer", id: "tr-1" });

    fireEvent.click(within(transferForm()).getByRole("button", { name: "Cancel" }));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  // No Techniques form deletes from inside itself (rows delete from the list's
  // trash icon). Removing a leg is the one in-dialog removal, and it's a draft
  // edit applied on save — the dialog must stay up.
  it("removing a leg inside the transaction form keeps it open, not onFocusClose", () => {
    const { onFocusClose } = renderFocused({ kind: "asset_transaction", id: "tx-sell" });

    fireEvent.click(dialog("Edit Transaction").getByRole("button", { name: "Remove Condo" }));

    expect(screen.getByRole("dialog", { name: "Edit Transaction" })).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "roth_conversion" as const, id: "rc-1", formId: "roth-conversion-form" },
    { kind: "relocation" as const, id: "rl-1", formId: "relocation-form" },
  ])("a successful $kind save calls onFocusClose()", async ({ kind, id, formId }) => {
    submit.mockResolvedValue({ ok: true, json: async () => ({ id }) });
    const { onFocusClose } = renderFocused({ kind, id });

    fireEvent.submit(document.getElementById(formId) as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "edit", targetKind: kind, targetId: id }),
      expect.anything(),
    );
  });

  it("a successful transfer save calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, json: async () => ({ id: "tr-1" }) });
    const { onFocusClose } = renderFocused({ kind: "transfer", id: "tr-1" });

    fireEvent.submit(transferForm());

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "edit", targetKind: "transfer", targetId: "tr-1" }),
      expect.anything(),
    );
  });

  it("a successful transaction save writes every leg of the bundle, then calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { onFocusClose } = renderFocused({ kind: "asset_transaction", id: "tx-sell" });

    fireEvent.submit(document.getElementById("asset-transaction-form") as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    for (const targetId of ["tx-sell", "tx-buy"]) {
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ op: "edit", targetKind: "asset_transaction", targetId }),
        expect.anything(),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Create and delete intents
// ---------------------------------------------------------------------------

describe("TechniquesView focus mode — create and delete intents", () => {
  it.each([
    { kind: "roth_conversion" as const, title: "New Roth Conversion" },
    { kind: "reinvestment" as const, title: "Add Reinvestment" },
    { kind: "relocation" as const, title: "Add Relocation" },
    { kind: "asset_transaction" as const, title: "Add Asset Transactions" },
  ])("create $kind opens the empty form alone, and cancel closes", ({ kind, title }) => {
    const { onFocusClose } = renderFocused({ intent: "create", kind });

    expect(screen.getByRole("dialog", { name: title })).toBeTruthy();
    expectNoPageChrome();
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(dialog(title).getByRole("button", { name: "Cancel" }));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("create transfer opens the empty transfer form alone, and cancel closes", () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "transfer" });

    expect(screen.getByRole("heading", { name: "Add Transfer" })).toBeTruthy();
    expectNoPageChrome();

    const form = screen.getByRole("heading", { name: "Add Transfer" }).closest("form") as HTMLFormElement;
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  describe("saving a create writes a scenario add", () => {
    beforeEach(() => submit.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "new" }) }));

    async function expectAddedAndClosed(onFocusClose: ReturnType<typeof vi.fn>, targetKind: string) {
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
      expect(onFocusClose).toHaveBeenCalledWith();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ op: "add", targetKind }),
        expect.anything(),
      );
    }

    it("relocation", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "relocation" });
      fireEvent.submit(document.getElementById("relocation-form") as HTMLFormElement);
      await expectAddedAndClosed(onFocusClose, "relocation");
    });

    it("roth conversion", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "roth_conversion" });
      fireEvent.change(screen.getByPlaceholderText("e.g., Roth Conversion 1"), { target: { value: "Conv A" } });
      fireEvent.change(screen.getByLabelText(/Fixed Amount/i), { target: { value: "10000" } });
      fireEvent.click(screen.getByRole("button", { name: /\+ Add/i }));
      fireEvent.click(screen.getByRole("button", { name: "Add Conversion" }));
      await expectAddedAndClosed(onFocusClose, "roth_conversion");
    });

    it("reinvestment", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "reinvestment" });
      fireEvent.click(screen.getByRole("button", { name: /Joint Brokerage/i }));
      fireEvent.submit(document.getElementById("reinvestment-form") as HTMLFormElement);
      await expectAddedAndClosed(onFocusClose, "reinvestment");
    });

    it("transfer", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "transfer" });
      fireEvent.submit(screen.getByRole("heading", { name: "Add Transfer" }).closest("form") as HTMLFormElement);
      await expectAddedAndClosed(onFocusClose, "transfer");
    });

    it("asset transaction", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "asset_transaction" });
      fireEvent.submit(document.getElementById("asset-transaction-form") as HTMLFormElement);
      await expectAddedAndClosed(onFocusClose, "asset_transaction");
    });
  });

  it("create for a kind this view doesn't create → unavailable", async () => {
    await expectUnavailable(renderFocused({ intent: "create", kind: "account" }));
  });

  it.each([
    { kind: "roth_conversion" as const, id: "rc-1", url: "/api/clients/c-1/roth-conversions?rothConversionId=rc-1" },
    { kind: "transfer" as const, id: "tr-1", url: "/api/clients/c-1/transfers?transferId=tr-1" },
    { kind: "reinvestment" as const, id: "ri-1", url: "/api/clients/c-1/reinvestments?reinvestmentId=ri-1" },
    { kind: "relocation" as const, id: "rl-1", url: "/api/clients/c-1/relocations?relocationId=rl-1" },
    { kind: "asset_transaction" as const, id: "tx-buy", url: "/api/clients/c-1/asset-transactions?transactionId=tx-buy" },
  ])("delete $kind removes that row through the writer with no prompt, then closes", async ({ kind, id, url }) => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    submit.mockResolvedValue({ ok: true, status: 204 });
    const { onFocusClose, container } = renderFocused({ intent: "delete", kind, id });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    // The writer turns this into a scenario `remove` change inside a scenario
    // (R1); the fallback is only ever used with no scenario active.
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      { op: "remove", targetKind: kind, targetId: id },
      { url, method: "DELETE" },
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container).toBeEmptyDOMElement();
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("delete does not close before the write resolves", async () => {
    let resolve!: (r: Pick<Response, "ok" | "status">) => void;
    submit.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onFocusClose } = renderFocused({ intent: "delete", kind: "transfer", id: "tr-1" });
    await act(async () => {});
    expect(onFocusClose).not.toHaveBeenCalled();
    resolve({ ok: true, status: 204 });
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
  });

  it("delete reports \"failed\" when the write fails", async () => {
    submit.mockResolvedValue({ ok: false, status: 500 });
    const { onFocusClose } = renderFocused({ intent: "delete", kind: "relocation", id: "rl-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("delete runs once under StrictMode", async () => {
    submit.mockResolvedValue({ ok: true, status: 204 });
    const onFocusClose = vi.fn();
    render(
      <StrictMode>
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <TechniquesView {...PROPS} focus={{ intent: "delete", kind: "transfer", id: "tr-1" }} onFocusClose={onFocusClose} />
        </ClientAccessProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "a row that isn't there", focus: { intent: "delete", kind: "transfer", id: "gone" } as EditorFocus },
    { label: "an id that belongs to another kind", focus: { intent: "delete", kind: "transfer", id: "rc-1" } as EditorFocus },
    { label: "a kind this view doesn't edit", focus: { intent: "delete", kind: "account", id: "acc-cash" } as EditorFocus },
  ])("delete of $label → unavailable, no write", async ({ focus }) => {
    await expectUnavailable(renderFocused(focus));
    expect(submit).not.toHaveBeenCalled();
  });

  it("delete without edit permission → unavailable, no write", async () => {
    await expectUnavailable(renderFocused({ intent: "delete", kind: "transfer", id: "tr-1" }, vi.fn(), "view"));
    expect(submit).not.toHaveBeenCalled();
  });
});
