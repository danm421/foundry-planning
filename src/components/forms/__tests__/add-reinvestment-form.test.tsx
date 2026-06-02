// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AddReinvestmentForm from "../add-reinvestment-form";

const refreshMock = vi.fn();
let searchParamsMock: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => "/clients/client-123",
}));

const ACCOUNTS = [
  { id: "acc-taxable", name: "Joint Brokerage", category: "taxable", subType: "taxable" },
  { id: "acc-cash", name: "Checking", category: "cash", subType: "checking" },
];

const MODEL_PORTFOLIOS = [
  { id: "mp-1", name: "Growth Portfolio" },
  { id: "mp-2", name: "Conservative Portfolio" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  searchParamsMock = new URLSearchParams("");
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "ri-1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddReinvestmentForm — draft mode", () => {
  it("calls onSubmitDraft with a Reinvestment object and does NOT call fetch", async () => {
    const onSubmitDraft = vi.fn();
    const onSaved = vi.fn();

    render(
      <AddReinvestmentForm
        clientId="client-123"
        accounts={ACCOUNTS}
        modelPortfolios={MODEL_PORTFOLIOS}
        onClose={() => {}}
        onSaved={onSaved}
        onSubmitDraft={onSubmitDraft}
      />,
    );

    // Fill the name field
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Shift to growth at retirement" },
    });

    // Select the first account (toggle button with aria-pressed)
    fireEvent.click(screen.getByRole("button", { name: /Joint Brokerage/i }));

    // targetType defaults to "model_portfolio"; MODEL_PORTFOLIOS[0] is pre-selected — no change needed.

    // Submit via the form element (matches id="reinvestment-form")
    fireEvent.submit(document.getElementById("reinvestment-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));

    const technique = onSubmitDraft.mock.calls[0][0];

    // Required Reinvestment fields
    expect(typeof technique.id).toBe("string");
    expect(technique.id.length).toBeGreaterThan(0);
    expect(technique.name).toBe("Shift to growth at retirement");
    expect(technique.accountIds).toContain("acc-taxable");
    expect(typeof technique.year).toBe("number");
    expect(technique.realizeTaxesOnSwitch).toBe(false);

    // Placeholder fields the solver server re-resolves
    expect(technique.newGrowthRate).toBe(0);
    expect(technique.soldFractionByAccount).toEqual({});

    // Resolution inputs
    expect(technique.targetType).toBe("model_portfolio");
    expect(technique.modelPortfolioId).toBe("mp-1");

    // fetch must NOT have been called for persistence
    expect(fetchMock).not.toHaveBeenCalled();

    // onSaved must have been called to close the dialog
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("preserves the selected model portfolio when editing a draft", async () => {
    render(
      <AddReinvestmentForm
        clientId="client-123"
        accounts={ACCOUNTS}
        modelPortfolios={MODEL_PORTFOLIOS}
        onClose={() => {}}
        onSaved={() => {}}
        onSubmitDraft={() => {}}
        initialData={{
          id: "ri-1",
          name: "Shift mix",
          accountIds: ["acc-taxable"],
          year: 2030,
          yearRef: null,
          targetType: "model_portfolio",
          realizeTaxesOnSwitch: false,
          // The draft carried the non-default ("Conservative") portfolio.
          modelPortfolioId: "mp-2",
        }}
      />,
    );

    const select = (await screen.findByLabelText(
      /model portfolio/i,
    )) as HTMLSelectElement;

    // Must reflect the saved model, not fall back to MODEL_PORTFOLIOS[0].
    expect(select.value).toBe("mp-2");

    // Draft edits never hit the DB to recover detail fields.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
