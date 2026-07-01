// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AddAssetTransactionForm from "../add-asset-transaction-form";

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
