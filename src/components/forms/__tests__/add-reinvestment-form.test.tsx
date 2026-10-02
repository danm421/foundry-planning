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
  // The combined group selector always loads the client's custom groups, in
  // draft mode too — that GET is expected, so it answers with a real list.
  fetchMock = vi.fn().mockImplementation(async (url: string) =>
    String(url).endsWith("/account-groups")
      ? { ok: true, json: async () => [] }
      : { ok: true, json: async () => ({ id: "ri-1" }) },
  );
  vi.stubGlobal("fetch", fetchMock);
});

/** Fetches other than the expected custom-group load. */
function nonGroupCalls() {
  return fetchMock.mock.calls.filter(
    ([url]) => !String(url).endsWith("/account-groups"),
  );
}

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
    expect(nonGroupCalls()).toEqual([]);

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
    expect(nonGroupCalls()).toEqual([]);
  });
});

const EDIT_ROW = {
  id: "ri-1",
  name: "Shift mix",
  accountIds: ["acc-taxable"],
  groupKeys: [] as string[],
  year: 2030,
  yearRef: null,
  targetType: "model_portfolio" as const,
  realizeTaxesOnSwitch: false,
  // The loader supplies the detail fields: this row's own portfolio.
  modelPortfolioId: "mp-2",
  customGrowthRate: null,
  customPctOrdinaryIncome: null,
  customPctLtCapitalGains: null,
  customPctQualifiedDividends: null,
  customPctTaxExempt: null,
};

function renderEdit(initialData: Record<string, unknown> = EDIT_ROW) {
  const onSaved = vi.fn();
  render(
    <AddReinvestmentForm
      clientId="client-123"
      accounts={ACCOUNTS}
      modelPortfolios={MODEL_PORTFOLIOS}
      onClose={() => {}}
      onSaved={onSaved}
      initialData={initialData as never}
    />,
  );
  return { onSaved };
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body);

describe("AddReinvestmentForm — opens on the row it was given", () => {
  it("does not fetch the base reinvestments when the loader supplied the detail fields", async () => {
    renderEdit();

    const select = (await screen.findByLabelText(/model portfolio/i)) as HTMLSelectElement;
    expect(select.value).toBe("mp-2");
    await waitFor(() => expect(urls()).toContain("/api/clients/client-123/account-groups"));
    expect(nonGroupCalls()).toEqual([]);
  });

  it("a custom-target row (portfolio null) is also supplied, so it does not fetch either", async () => {
    renderEdit({ ...EDIT_ROW, targetType: "custom", modelPortfolioId: null, customGrowthRate: 0.065 });

    // The row's own rate, as a percent, is in the form from the first render.
    expect(await screen.findByDisplayValue("6.5")).toBeTruthy();
    expect(nonGroupCalls()).toEqual([]);
  });

  it("still backfills from the reinvestments list when the detail fields were not supplied (base mode)", async () => {
    const { modelPortfolioId: _omit, ...legacy } = EDIT_ROW;
    void _omit;
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/account-groups")
        ? { ok: true, json: async () => [] }
        : {
            ok: true,
            json: async () => [
              { id: "ri-1", modelPortfolioId: "mp-2", customGrowthRate: null, groupKeys: [] },
            ],
          },
    );
    renderEdit(legacy);

    await waitFor(() => expect(urls()).toContain("/api/clients/client-123/reinvestments"));
  });
});

describe("AddReinvestmentForm — scenario mode", () => {
  beforeEach(() => {
    searchParamsMock = new URLSearchParams("scenario=scn-1");
  });

  it("saves the scenario's portfolio as ONE scenario change — no base GET, no base write", async () => {
    const { onSaved } = renderEdit();
    await screen.findByLabelText(/model portfolio/i);

    fireEvent.submit(document.getElementById("reinvestment-form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    // The WHOLE request list: the custom-group load, then one scenario change.
    expect(urls()).toEqual([
      "/api/clients/client-123/account-groups",
      "/api/clients/client-123/scenarios/scn-1/changes",
    ]);
    const change = bodyOf(fetchMock.mock.calls[1]);
    expect(change).toMatchObject({ op: "edit", targetKind: "reinvestment", targetId: "ri-1" });
    // The scenario's own portfolio, not the first model or a base row's.
    expect(change.desiredFields.modelPortfolioId).toBe("mp-2");
  });

  it("an add posts one scenario change carrying a fresh id — no base write", async () => {
    const onSaved = vi.fn();
    render(
      <AddReinvestmentForm
        clientId="client-123"
        accounts={ACCOUNTS}
        modelPortfolios={MODEL_PORTFOLIOS}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Joint Brokerage/i }));
    fireEvent.submit(document.getElementById("reinvestment-form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    expect(nonGroupCalls().map(([url]) => String(url))).toEqual([
      "/api/clients/client-123/scenarios/scn-1/changes",
    ]);
    const change = bodyOf(nonGroupCalls()[0]);
    expect(change).toMatchObject({ op: "add", targetKind: "reinvestment" });
    expect(change.entity.id).toEqual(expect.any(String));
    expect(change.entity.accountIds).toEqual(["acc-taxable"]);
  });
});

describe("AddReinvestmentForm — base mode", () => {
  it("an edit still PUTs the base reinvestments route", async () => {
    const { onSaved } = renderEdit();
    await screen.findByLabelText(/model portfolio/i);

    fireEvent.submit(document.getElementById("reinvestment-form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const put = nonGroupCalls().find(([, init]) => (init as { method?: string })?.method === "PUT")!;
    expect(String(put[0])).toBe("/api/clients/client-123/reinvestments");
    expect(bodyOf(put)).toMatchObject({ reinvestmentId: "ri-1", modelPortfolioId: "mp-2" });
  });
});
