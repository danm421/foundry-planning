// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AddReinvestmentForm from "../add-reinvestment-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddReinvestmentForm — draft mode", () => {
  it("emits a Reinvestment with raw inputs and placeholder resolved fields", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const onSubmitDraft = vi.fn();
    render(
      <AddReinvestmentForm
        clientId="c1"
        accounts={[
          { id: "acc-1", name: "Brokerage", category: "taxable", subType: "brokerage" },
        ]}
        modelPortfolios={[{ id: "mp-1", name: "Growth" }]}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={onSubmitDraft}
      />,
    );

    // Fill in the required name field
    fireEvent.change(screen.getByPlaceholderText(/Shift to growth portfolio/i), {
      target: { value: "Test Reinvestment" },
    });

    // Select the account via its labeled checkbox
    fireEvent.click(screen.getByLabelText(/Brokerage/i));

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));
    const arg = onSubmitDraft.mock.calls[0][0];
    expect(arg.accountIds).toEqual(["acc-1"]);
    expect(arg.newGrowthRate).toBe(0);
    expect(arg.soldFractionByAccount).toEqual({});
    expect(typeof arg.id).toBe("string");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
