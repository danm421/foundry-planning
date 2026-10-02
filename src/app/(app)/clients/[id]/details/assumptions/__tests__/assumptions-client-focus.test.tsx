// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab asks the Assumptions view to open ONE
 * editor: a deduction, tax adjustment or withdrawal-order row (edit, create or
 * delete), or the Savings & Withdrawals tab in a dialog.
 *
 * The props hold the SCENARIO's rows (the loader reads the effective tree), so
 * an edit opens on the scenario's values and every write is a scenario change:
 * each test asserts the request URL and method — the scenario changes route,
 * never a base route.
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("scenario=scn-1&tab=deductions"),
  usePathname: () => "/clients/c-1/solver",
}));

import AssumptionsClient, {
  type AssumptionsClientProps,
} from "../assumptions-client";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";

type OnFocusClose = Mock<(outcome?: FocusCloseOutcome) => void>;

// ---------------------------------------------------------------------------
// Fixture — one row of each kind the resolver sends to this page.
// ---------------------------------------------------------------------------

const PROPS: AssumptionsClientProps = {
  clientId: "c-1",
  scenarioName: "Plan B",
  settings: {
    flatFederalRate: "0.22",
    flatStateRate: "0.05",
    estateAdminExpenses: "0",
    flatStateEstateRate: "0",
    residenceState: null,
    irdTaxRate: "0",
    probateCostRate: "0",
    pvDiscountRate: "",
    inflationRate: "0.025",
    inflationRateSource: "custom",
    planStartYear: 2026,
    planEndYear: 2060,
    defaultGrowthTaxable: "0.06",
    defaultGrowthCash: "0.02",
    defaultGrowthRetirement: "0.06",
    defaultGrowthRealEstate: "0.03",
    defaultGrowthBusiness: "0.04",
    defaultGrowthLifeInsurance: "0.03",
    taxEngineMode: "bracket",
    taxInflationRate: "",
    lifetimeExemptionCap: "",
    ssWageGrowthRate: "",
    medicarePremiumInflationRate: "0.03",
    medicarePremiumInflationEnabled: false,
    outOfHouseholdDniRate: "0",
    priorTaxableGiftsClient: "0",
    priorTaxableGiftsSpouse: "0",
    capitalLossCarryforwardSt: "",
    capitalLossCarryforwardLt: "",
    capitalLossCarryforwardLtSourceYear: null,
    surplusSpendPct: "0",
    surplusSaveAccountId: null,
    surplusSpendAllUntilRetirement: false,
    coveredByWorkplacePlan: "auto",
    spouseCoveredByWorkplacePlan: "auto",
  },
  accounts: [{ id: "acct-1", name: "Fidelity Brokerage", category: "taxable", subType: "brokerage" }],
  withdrawalStrategies: [{ id: "ws-1", accountId: "acct-1", priorityOrder: 1, startYear: 2030, endYear: 2060 }],
  resolvedInflationRate: 0.025,
  assetClassInflationRate: 0.025,
  hasInflationAssetClass: false,
  deductionsData: {
    derivedRows: [],
    expenseDeductionRows: [],
    mortgageRows: [],
    propertyTaxRows: [],
    itemizedRows: [
      {
        id: "ded-1",
        type: "charitable",
        name: "First Baptist Church",
        owner: "joint",
        annualAmount: 18000, // the scenario's value; the base row says 12000
        growthRate: 0,
        startYear: 2026,
        endYear: 2040,
        startYearRef: null,
        endYearRef: null,
      },
    ],
    currentYear: 2026,
    saltCap: 40000,
  },
  taxAdjustmentRows: [
    {
      id: "adj-1",
      taxType: "capital_gains",
      name: "2026 home sale gain",
      owner: "joint",
      annualAmount: 80000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2026,
      startYearRef: null,
      endYearRef: null,
      withheldMode: "none",
      withheldValue: 0,
    },
  ],
  liquidAccounts: [],
  allAccounts: [],
};

function renderView(props: Partial<AssumptionsClientProps> = {}) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <AssumptionsClient {...PROPS} {...props} />
    </ClientAccessProvider>,
  );
}

function renderFocused(focus: EditorFocus, onFocusClose: OnFocusClose = vi.fn()) {
  return { ...renderView({ focus, onFocusClose }), onFocusClose };
}

const CHANGES_URL = "/api/clients/c-1/scenarios/scn-1/changes";
const fetchMock = vi.fn();

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, method: init.method, body: JSON.parse(init.body) };
}

/** Exactly one request was made, and it went to the scenario changes route. */
function expectOnlyScenarioWrite() {
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([CHANGES_URL]);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function expectUnavailable(utils: { container: HTMLElement; onFocusClose: OnFocusClose }) {
  await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));
  expect(utils.onFocusClose).toHaveBeenCalledWith("unavailable");
  expect(utils.container).toBeEmptyDOMElement();
  expect(fetchMock).not.toHaveBeenCalled();
}

describe("AssumptionsClient focus mode — deductions", () => {
  it("edit opens that deduction's form on the SCENARIO's values, and saves to the scenario", async () => {
    const { onFocusClose } = renderFocused({ kind: "client_deduction", id: "ded-1" });

    expect(screen.getByRole("heading", { name: "Edit deduction" })).toBeTruthy();
    expect(screen.getByDisplayValue("18000")).toBeTruthy();
    expect(screen.getByDisplayValue("First Baptist Church")).toBeTruthy();
    // Nothing but the dialog: no page chrome, no list.
    expect(screen.queryByRole("button", { name: "+ Add deduction" })).toBeNull();
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "edit", targetKind: "client_deduction", targetId: "ded-1" },
    });
  });

  it("create opens the add form and posts an add to the scenario", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "client_deduction" });

    expect(screen.getByRole("heading", { name: "Add deduction" })).toBeTruthy();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "add", targetKind: "client_deduction", entity: { annualAmount: 5000 } },
    });
  });

  it("cancel closes without writing", async () => {
    const { onFocusClose } = renderFocused({ kind: "client_deduction", id: "ded-1" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delete posts a remove to the scenario with no prompt, then closes", async () => {
    const { container, onFocusClose } = renderFocused({ intent: "delete", kind: "client_deduction", id: "ded-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(window.confirm).not.toHaveBeenCalled();
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "remove", targetKind: "client_deduction", targetId: "ded-1" },
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AssumptionsClient focus mode — tax adjustments", () => {
  it("edit opens that adjustment's form and saves to the scenario", async () => {
    const { onFocusClose } = renderFocused({ kind: "client_tax_adjustment", id: "adj-1" });

    expect(screen.getByRole("heading", { name: "Edit tax adjustment" })).toBeTruthy();
    expect(screen.getByDisplayValue("2026 home sale gain")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "edit", targetKind: "client_tax_adjustment", targetId: "adj-1" },
    });
  });

  it("create opens the add form and posts an add to the scenario", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "client_tax_adjustment" });

    expect(screen.getByRole("heading", { name: "Add tax adjustment" })).toBeTruthy();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "7000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "add", targetKind: "client_tax_adjustment", entity: { annualAmount: 7000 } },
    });
  });

  it("delete posts a remove to the scenario with no prompt, then closes", async () => {
    const { onFocusClose } = renderFocused({ intent: "delete", kind: "client_tax_adjustment", id: "adj-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(window.confirm).not.toHaveBeenCalled();
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "remove", targetKind: "client_tax_adjustment", targetId: "adj-1" },
    });
  });
});

describe("AssumptionsClient focus mode — withdrawal order", () => {
  it("edit opens that entry's dialog alone (no surplus form) and saves to the scenario", async () => {
    const { onFocusClose } = renderFocused({ kind: "withdrawal_strategy", id: "ws-1" });

    expect(screen.getByRole("heading", { name: "Edit Withdrawal Entry" })).toBeTruthy();
    expect(screen.queryByText(/surplus/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "edit", targetKind: "withdrawal_strategy", targetId: "ws-1" },
    });
  });

  it("create opens the add dialog and posts an add to the scenario", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "withdrawal_strategy" });

    expect(screen.getByRole("heading", { name: "Add Withdrawal Entry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Entry" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "add", targetKind: "withdrawal_strategy", entity: { accountId: "acct-1" } },
    });
  });

  it("delete posts a remove to the scenario with no prompt, then closes", async () => {
    const { container, onFocusClose } = renderFocused({ intent: "delete", kind: "withdrawal_strategy", id: "ws-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(window.confirm).not.toHaveBeenCalled();
    expectOnlyScenarioWrite();
    expect(lastRequest()).toMatchObject({
      url: CHANGES_URL,
      method: "POST",
      body: { op: "remove", targetKind: "withdrawal_strategy", targetId: "ws-1" },
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AssumptionsClient focus mode — Savings & Withdrawals tab", () => {
  it("plan_settings 'withdrawal' renders the tab in a dialog titled with the scenario", () => {
    const { onFocusClose } = renderFocused({ intent: "edit", kind: "plan_settings", id: "withdrawal" });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Savings & Withdrawals — Plan B")).toBeTruthy();
    expect(within(dialog).getByText("Withdrawal Strategy")).toBeTruthy();
    expect(within(dialog).getByText("Surplus Cash Flow")).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it("closing the dialog hands control back with no outcome, once", async () => {
    const { onFocusClose } = renderFocused({ kind: "plan_settings", id: "withdrawal" });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
  });
});

describe("AssumptionsClient focus mode — nothing to open", () => {
  it.each([
    ["a deduction that isn't there", { kind: "client_deduction", id: "gone" }],
    ["a tax adjustment that isn't there", { kind: "client_tax_adjustment", id: "gone" }],
    ["a withdrawal entry that isn't there", { kind: "withdrawal_strategy", id: "gone" }],
    ["a delete of a row that isn't there", { intent: "delete", kind: "client_deduction", id: "gone" }],
    ["the Tax Rates tab (Task 14)", { kind: "plan_settings", id: "tax-rates" }],
    ["the Growth & Inflation tab (Task 15)", { kind: "plan_settings", id: "growth-inflation" }],
    ["a kind this page doesn't edit", { kind: "account", id: "acct-1" }],
  ] as [string, EditorFocus][])("%s → unavailable", async (_name, focus) => {
    await expectUnavailable(renderFocused(focus));
  });

  it("a viewer with no edit access gets nothing, whatever the row", async () => {
    const onFocusClose: OnFocusClose = vi.fn();
    const utils = render(
      <ClientAccessProvider value={{ permission: "view", access: "own" }}>
        <AssumptionsClient {...PROPS} focus={{ kind: "client_deduction", id: "ded-1" }} onFocusClose={onFocusClose} />
      </ClientAccessProvider>,
    );
    await expectUnavailable({ container: utils.container, onFocusClose });
  });
});

describe("AssumptionsClient focus mode — failures and re-renders", () => {
  it("a delete the server refuses reports 'failed', once, without alerting", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "no" }), { status: 500 }));
    const { onFocusClose } = renderFocused({ intent: "delete", kind: "withdrawal_strategy", id: "ws-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith("failed");
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("a delete runs once under StrictMode", async () => {
    const onFocusClose: OnFocusClose = vi.fn();
    render(
      <StrictMode>
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <AssumptionsClient
            {...PROPS}
            focus={{ intent: "delete", kind: "client_tax_adjustment", id: "adj-1" }}
            onFocusClose={onFocusClose}
          />
        </ClientAccessProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fires once, even after a parent re-render with fresh inline props", async () => {
    const utils = renderFocused({ kind: "client_deduction", id: "gone" });
    await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));

    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <AssumptionsClient
          {...PROPS}
          focus={{ kind: "client_deduction", id: "gone" }}
          onFocusClose={utils.onFocusClose}
        />
      </ClientAccessProvider>,
    );
    expect(utils.onFocusClose).toHaveBeenCalledTimes(1);
  });
});

describe("AssumptionsClient without focus", () => {
  it("renders the page as before — the Deductions tab lists the row", () => {
    renderView();

    expect(screen.getByText("First Baptist Church")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit First Baptist Church" })).toBeTruthy();
  });
});
