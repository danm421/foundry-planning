// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AddAssetTransactionForm from "../add-asset-transaction-form";
import type { AssetTransactionInitialData } from "../add-asset-transaction-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123",
}));

const ACCOUNTS = [
  { id: "acc-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage" },
];
const LIABILITIES: { id: string; name: string; linkedPropertyId: string | null; balance: string }[] = [];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  let n = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `test-uuid-${++n}` });
});
afterEach(() => vi.unstubAllGlobals());

describe("AddAssetTransactionForm — add mode fan-out", () => {
  it("emits one draft per leg for a 2-sell + 1-buy bundle, all sharing the year", async () => {
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    const onSaved = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={onSaved}
        onSubmitDraft={onSubmitDraft}
      />,
    );

    // Shared name + year.
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Downsize 2030" } });
    fireEvent.change(screen.getByLabelText(/^Year/i), { target: { value: "2030" } });

    // The ledger starts with one sell leg. Add a second sell and one buy.
    fireEvent.click(screen.getByRole("button", { name: /Add sell/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));

    // Source both sell legs to the brokerage account. Each sell row selects the
    // leg into the middle editor column when clicked.
    const sellColumn = screen.getByTestId("sell-column");
    const sellRows = within(sellColumn).getAllByRole("button", { name: /^New sale/i });
    expect(sellRows).toHaveLength(2);

    for (const row of sellRows) {
      fireEvent.click(row);
      const sourceSelect = screen.getByLabelText(/Account to Sell/i);
      fireEvent.change(sourceSelect, { target: { value: "acc-brokerage" } });
      fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));
    }

    // Fill the buy leg: asset name + purchase price make it valid.
    const buyColumn = screen.getByTestId("buy-column");
    fireEvent.click(within(buyColumn).getByRole("button", { name: /^New purchase/i }));
    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "Condo" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(3));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(drafts.filter((d: any) => d.type === "sell")).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(drafts.filter((d: any) => d.type === "buy")).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).every((d) => d.year === 2030)).toBe(true);
    // no persist POST in draft mode
    expect(fetchMock.mock.calls.filter((a) => String(a[0]).includes("asset-transactions"))).toHaveLength(0);
    expect(onSaved).toHaveBeenCalledTimes(1);

    // Every leg from one dialog carries ONE bundle id — that is what makes the
    // Techniques list show them as a single technique.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundleIds = new Set((drafts as any[]).map((d) => d.bundleId));
    expect(bundleIds.size).toBe(1);
    expect([...bundleIds][0]).toBeTruthy();
  });
});

describe("AddAssetTransactionForm — edit mode", () => {
  it("loads a single sell record and emits exactly one draft on save", async () => {
    const onSubmitDraft = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={{
          id: "rec-1", name: "Sell Brokerage", type: "sell", year: 2031,
          accountId: "acc-brokerage", purchaseTransactionId: null, businessAccountId: null,
          fractionSold: null, overrideSaleValue: null, overrideBasis: null,
          transactionCostPct: null, transactionCostFlat: null, proceedsAccountId: null,
          qualifiesForHomeSaleExclusion: null, assetName: null, assetCategory: null, assetSubType: null,
          purchasePrice: null, growthRate: null, basis: null, fundingAccountId: null,
          mortgageAmount: null, mortgageRate: null, mortgageTermMonths: null,
        }}
      />,
    );
    fireEvent.submit(document.getElementById("asset-transaction-form")!);
    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));
    expect(onSubmitDraft.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: "rec-1", type: "sell", year: 2031 }),
    );
  });
});

describe("AddAssetTransactionForm — bundle edit mode", () => {
  const SELL_RECORD = {
    id: "rec-sell", name: "Move house — Sell Brokerage", type: "sell" as const, year: 2031,
    accountId: "acc-brokerage", purchaseTransactionId: null, businessAccountId: null,
    fractionSold: null, overrideSaleValue: null, overrideBasis: null,
    transactionCostPct: null, transactionCostFlat: null, proceedsAccountId: null,
    qualifiesForHomeSaleExclusion: null, assetName: null, assetCategory: null, assetSubType: null,
    purchasePrice: null, growthRate: null, basis: null, fundingAccountId: null,
    mortgageAmount: null, mortgageRate: null, mortgageTermMonths: null,
    bundleId: "bun-1",
  };
  const BUY_RECORD = {
    ...SELL_RECORD,
    id: "rec-buy", name: "Move house — Buy Condo", type: "buy" as const,
    accountId: null, assetName: "Condo", assetCategory: "real_estate", assetSubType: "primary_residence",
    purchasePrice: "800000",
  };

  // A record with no bundleId field at all — a leg saved before bundles existed.
  const UNBUNDLED_RECORD: AssetTransactionInitialData = { ...SELL_RECORD };
  delete UNBUNDLED_RECORD.bundleId;

  it("seeds a leg per record and writes each one back on save", async () => {
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={SELL_RECORD}
        bundleRecords={[SELL_RECORD, BUY_RECORD]}
      />,
    );

    // The Name field shows the bundle name, not one leg's derived name.
    expect((screen.getByLabelText(/^Name/i) as HTMLInputElement).value).toBe("Move house");
    // One row in each ledger column. The regex is start-anchored because each
    // row renders TWO buttons — the row-select one, whose accessible name is the
    // label plus its net figure ("Brokerage$0"), and a sibling "Remove
    // <label>". Only the row-select name STARTS with the label.
    expect(
      within(screen.getByTestId("sell-column")).getAllByRole("button", { name: /^Brokerage/i }),
    ).toHaveLength(1);
    expect(
      within(screen.getByTestId("buy-column")).getAllByRole("button", { name: /^Condo/i }),
    ).toHaveLength(1);

    // Renaming the transaction must rename EVERY leg — leg names are derived,
    // never hand-typed, so nothing the advisor wrote is clobbered.
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Moved" } });

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).map((d) => d.id).sort()).toEqual(["rec-buy", "rec-sell"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).every((d) => d.bundleId === "bun-1")).toBe(true);

    // Each record is written under its DERIVED name: "<bundle> — <verb> <asset>",
    // separated by an EM DASH (U+2014), never a hyphen or an en dash.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>((drafts as any[]).map((d) => [d.id, d]));
    expect(byId.get("rec-sell").name).toBe("Moved — Sell Brokerage");
    expect(byId.get("rec-buy").name).toBe("Moved — Buy Condo");
  });

  it("deletes a record whose leg was removed in the dialog", async () => {
    const onSubmitDraft = vi.fn();
    const onDeleteDraft = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        onDeleteDraft={onDeleteDraft}
        initialData={SELL_RECORD}
        bundleRecords={[SELL_RECORD, BUY_RECORD]}
      />,
    );

    const buyColumn = screen.getByTestId("buy-column");
    fireEvent.click(within(buyColumn).getByRole("button", { name: /Remove/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onDeleteDraft).toHaveBeenCalledWith("rec-buy"));
    expect(onSubmitDraft).toHaveBeenCalledTimes(1);
    expect(onSubmitDraft.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "rec-sell" }));
  });

  it("adds a new leg to the existing bundle", async () => {
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={SELL_RECORD}
        bundleRecords={[SELL_RECORD]}
      />,
    );

    // Edit mode can grow a bundle — the Add controls are live.
    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));
    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "Condo" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).every((d) => d.bundleId === "bun-1")).toBe(true);
    // The new leg is a fresh record; the existing one keeps its id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).map((d) => d.id)).toContain("rec-sell");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).some((d) => d.id !== "rec-sell" && d.type === "buy")).toBe(true);
  });

  it("does not mint a bundle id for a caller that is not bundle-aware", async () => {
    // A caller that hands over one record without saying what its siblings are
    // knows nothing about bundles. Minting an id here would PUT a NEW id over
    // the record's real one, pulling it out of its bundle and orphaning the
    // siblings still carrying the old id. Both real callers — Solver and
    // Details — now always pass `bundleRecords`; this pins the guard for any
    // future caller that does not.
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={UNBUNDLED_RECORD}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));
    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "Condo" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(2));
    // No id on either record: the edit omits the field entirely, so the route
    // leaves the record's real bundle_id untouched.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts as any[]).every((d) => d.bundleId === undefined)).toBe(true);
  });

  it("mints one shared id when a bundle-aware caller grows a bundle-less record", async () => {
    // Same interaction, but the caller passed `bundleRecords` — so it DOES know
    // the record has no bundle, and a fresh shared id is the right answer.
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={UNBUNDLED_RECORD}
        bundleRecords={[UNBUNDLED_RECORD]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));
    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "Condo" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = new Set((drafts as any[]).map((d) => d.bundleId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
  });

  it("refuses the save when a leg was dropped and nothing can delete it", async () => {
    // Draft mode with no `onDeleteDraft`: the dropped record cannot be deleted,
    // and silently keeping it would make the removed leg reappear. Fail loudly.
    const onSubmitDraft = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={SELL_RECORD}
        bundleRecords={[SELL_RECORD, BUY_RECORD]}
      />,
    );

    fireEvent.click(
      within(screen.getByTestId("buy-column")).getByRole("button", { name: /Remove/i }),
    );
    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Can't remove that leg here/),
    );
    // And nothing was written — a half-save would orphan the dropped record.
    expect(onSubmitDraft).not.toHaveBeenCalled();
  });

  it("issues the PUT, POST and DELETE itself when it is not in draft mode", async () => {
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        initialData={SELL_RECORD}
        bundleRecords={[SELL_RECORD, BUY_RECORD]}
      />,
    );

    // Drop the seeded buy leg and add a different one, so ONE save exercises all
    // three persisting paths at once.
    fireEvent.click(
      within(screen.getByTestId("buy-column")).getByRole("button", { name: /Remove/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));
    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "Condo" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    const writes = () =>
      fetchMock.mock.calls.filter((a) => String(a[0]).includes("asset-transactions"));
    await waitFor(() => expect(writes()).toHaveLength(3));

    const URL = "/api/clients/client-123/asset-transactions";
    expect(writes().map((a) => [a[0], a[1].method])).toEqual([
      [URL, "PUT"],
      [URL, "POST"],
      [`${URL}?transactionId=rec-buy`, "DELETE"],
    ]);
    // The PUT names the record it updates in the body.
    expect(JSON.parse(writes()[0][1].body).transactionId).toBe("rec-sell");
    // The POST creates the new leg inside the SAME bundle.
    expect(JSON.parse(writes()[1][1].body)).toEqual(
      expect.objectContaining({ type: "buy", assetName: "Condo", bundleId: "bun-1" }),
    );
  });

  it("keeps the name verbatim when the save ends up with ONE record again", async () => {
    // Replace the only leg: the old record is deleted and one new record takes
    // its place. That is still a LONE record, so its name is the Name field
    // verbatim — the derived "<name> — Buy <asset>" form is for real bundles.
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    const onDeleteDraft = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        onDeleteDraft={onDeleteDraft}
        initialData={UNBUNDLED_RECORD}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Swap" } });
    fireEvent.click(
      within(screen.getByTestId("sell-column")).getByRole("button", { name: /Remove/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));
    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "Condo" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));
    expect(onDeleteDraft).toHaveBeenCalledWith("rec-sell");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((drafts[0] as any).name).toBe("Swap");
  });

  it("keeps a legacy swap row's own name and stamps no bundle id", async () => {
    // ONE record carrying both a sell side and a buy side. It expands to two
    // legs bound to the same id, merges back into itself, and is NOT a bundle —
    // so the name must survive verbatim and no bundleId may be invented.
    const onSubmitDraft = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={{
          ...SELL_RECORD,
          id: "rec-swap", name: "Lake swap", bundleId: null,
          assetName: "Cabin", assetCategory: "real_estate",
          assetSubType: "primary_residence", purchasePrice: "500000",
        }}
      />,
    );

    // Two legs, one per side of the single record.
    expect(within(screen.getByTestId("sell-column")).getAllByRole("button", { name: /^Brokerage/i })).toHaveLength(1);
    expect(within(screen.getByTestId("buy-column")).getAllByRole("button", { name: /^Cabin/i })).toHaveLength(1);

    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));
    const draft = onSubmitDraft.mock.calls[0][0];
    expect(draft).toEqual(
      expect.objectContaining({
        id: "rec-swap", name: "Lake swap", type: "sell",
        accountId: "acc-brokerage", assetName: "Cabin", purchasePrice: 500000,
      }),
    );
    expect(draft.bundleId).toBeUndefined();
  });

  it("leaves a lone standalone record's name alone", async () => {
    const onSubmitDraft = vi.fn();
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
        initialData={{ ...SELL_RECORD, id: "rec-solo", name: "Sell the boat", bundleId: null }}
      />,
    );
    fireEvent.submit(document.getElementById("asset-transaction-form")!);
    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));
    expect(onSubmitDraft.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: "rec-solo", name: "Sell the boat" }),
    );
  });
});

describe("AddAssetTransactionForm — buy-leg property tax", () => {
  /** Render the dialog, add a buy leg, and open it in the editor column. */
  function openBuyLeg(onSubmitDraft = vi.fn()) {
    render(
      <AddAssetTransactionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        liabilities={LIABILITIES}
        onClose={() => {}}
        onSaved={vi.fn()}
        onSubmitDraft={onSubmitDraft}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add buy/i }));
    const buyColumn = screen.getByTestId("buy-column");
    fireEvent.click(within(buyColumn).getByRole("button", { name: /^New purchase/i }));
    return onSubmitDraft;
  }

  it("shows the property tax block for a real-estate buy", () => {
    openBuyLeg();
    // emptyBuyLeg defaults assetCategory to real_estate.
    expect(screen.getByLabelText(/Annual Property Tax/i)).toBeInTheDocument();
  });

  it("hides the property tax block for a taxable buy", () => {
    openBuyLeg();
    fireEvent.change(screen.getByLabelText(/Asset Category/i), { target: { value: "taxable" } });
    expect(screen.queryByLabelText(/Annual Property Tax/i)).not.toBeInTheDocument();
  });

  it("clears the property tax when the category leaves real estate", () => {
    openBuyLeg();
    fireEvent.change(screen.getByLabelText(/Annual Property Tax/i), { target: { value: "16500" } });
    fireEvent.change(screen.getByLabelText(/Asset Category/i), { target: { value: "taxable" } });
    fireEvent.change(screen.getByLabelText(/Asset Category/i), { target: { value: "real_estate" } });
    expect(screen.getByLabelText(/Annual Property Tax/i)).toHaveValue("");
  });

  it("sends the amount as dollars and the growth as a decimal rate", async () => {
    const drafts: unknown[] = [];
    const onSubmitDraft = vi.fn((t) => drafts.push(t));
    openBuyLeg(onSubmitDraft);

    fireEvent.change(screen.getByLabelText(/Asset Name/i), { target: { value: "New House" } });
    fireEvent.change(document.getElementById("purchasePrice") as HTMLInputElement, {
      target: { value: "1500000" },
    });
    fireEvent.change(screen.getByLabelText(/Annual Property Tax/i), { target: { value: "16500" } });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Buy House" } });
    fireEvent.change(screen.getByLabelText(/^Year/i), { target: { value: "2032" } });
    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalled());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buy = (drafts as any[]).find((d) => d.type === "buy");
    // onSubmitDraft receives coerceAssetTransactionDraft's output (an
    // AssetTransaction), which numifies string fields the same way it
    // already does for the sibling purchasePrice field — see the "legacy
    // swap" test above (`purchasePrice: 500000`, a number, from a
    // string "500000" input).
    expect(buy.annualPropertyTax).toBe(16500);
    expect(buy.propertyTaxGrowthRate).toBe(0.03);   // "3" percent → decimal
    expect(buy.propertyTaxGrowthSource).toBe("custom");
  });
});
