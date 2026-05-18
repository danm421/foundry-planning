// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AddAssetTransactionForm from "../add-asset-transaction-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddAssetTransactionForm — draft mode", () => {
  it("emits a numeric AssetTransaction and does not call the API endpoint", async () => {
    const onSubmitDraft = vi.fn();
    const { container } = render(
      <AddAssetTransactionForm
        clientId="c1"
        accounts={[
          { id: "acc-1", name: "Brokerage", category: "taxable", subType: "brokerage" },
        ]}
        liabilities={[]}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
      />,
    );

    // Expand the buy side (collapsed by default when no initialData)
    const buttons = screen.getAllByRole("button");
    const buySideBtn = buttons.find((b) => (b.textContent ?? "").trim().includes("Buy Side"));
    if (buySideBtn) fireEvent.click(buySideBtn);

    // Fill in asset name to satisfy buyHasData condition
    fireEvent.change(container.querySelector("#assetName")!, {
      target: { value: "Lake house" },
    });

    // Fill in purchase price via the input rendered by CurrencyInput
    fireEvent.change(container.querySelector("#purchasePrice")!, {
      target: { value: "450000" },
    });

    // Submit via the form element (fireEvent.submit is reliable in jsdom)
    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));

    const arg = onSubmitDraft.mock.calls[0][0];
    expect(typeof arg.id).toBe("string");
    expect(arg.type).toBe("buy");
    expect(arg.purchasePrice).toBe(450000);

    // The only fetch call should be for projection-data, not the asset-transactions API
    const apiCalls = fetchMock.mock.calls.filter((args: unknown[]) =>
      typeof args[0] === "string" && args[0].includes("asset-transactions"),
    );
    expect(apiCalls).toHaveLength(0);
  });
});
