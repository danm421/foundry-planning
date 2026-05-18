// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", {
    randomUUID: () => "test-uuid-1234",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddAssetTransactionForm — draft mode", () => {
  it("calls onSubmitDraft with a numeric AssetTransaction and does NOT POST to asset-transactions", async () => {
    const onSubmitDraft = vi.fn();
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

    // Fill in the required Transaction Name field
    fireEvent.change(screen.getByLabelText(/Transaction Name/i), {
      target: { value: "Buy Rental" },
    });

    // Expand Buy Side and fill asset name + purchase price
    fireEvent.click(screen.getByRole("button", { name: /Buy Side/i }));

    fireEvent.change(screen.getByLabelText(/Asset Name/i), {
      target: { value: "123 Oak Ave" },
    });

    // Purchase Price is a CurrencyInput — interact via its input element
    const purchasePriceInput = document.getElementById("purchasePrice") as HTMLInputElement;
    fireEvent.change(purchasePriceInput, { target: { value: "450000" } });

    // Submit via the form element (as DialogShell primaryAction does)
    fireEvent.submit(document.getElementById("asset-transaction-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));

    const technique = onSubmitDraft.mock.calls[0][0];

    // purchasePrice must be coerced to a number
    expect(technique.purchasePrice).toBe(450000);
    expect(typeof technique.id).toBe("string");
    expect(technique.id.length).toBeGreaterThan(0);

    // Assert that the persist endpoint was NOT called
    const assetTransactionWriteCalls = fetchMock.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("asset-transactions"),
    );
    expect(assetTransactionWriteCalls).toHaveLength(0);

    // onSaved must be called to close the dialog
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
