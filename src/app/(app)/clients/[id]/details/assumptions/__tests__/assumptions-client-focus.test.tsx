// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab asks the Assumptions view to open ONE
 * row's editor.
 *
 * The page lists deductions, tax adjustments and withdrawal-order rows from
 * the BASE plan's tables whatever scenario is selected (`loadAssumptionsViewProps`
 * queries them by the base-case scenario id). A focused editor would open on
 * base values, and its save would overwrite the scenario's own change with
 * them (rulings T4c-reinvestment / T4d-member). So every focus is reported
 * "unavailable" — even when the row IS in the lists — and nothing renders.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
        annualAmount: 12000,
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

async function expectUnavailable(utils: { container: HTMLElement; onFocusClose: OnFocusClose }) {
  await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));
  expect(utils.onFocusClose).toHaveBeenCalledWith("unavailable");
  expect(utils.container).toBeEmptyDOMElement();
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssumptionsClient focus mode — every row is unavailable", () => {
  it.each([
    { kind: "client_deduction" as const, id: "ded-1" },
    { kind: "client_tax_adjustment" as const, id: "adj-1" },
    { kind: "withdrawal_strategy" as const, id: "ws-1" },
  ])("$kind → unavailable, even though the row is there", async (focus) => {
    await expectUnavailable(renderFocused(focus));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a row that isn't there → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "client_deduction", id: "gone" }));
  });

  it("a kind this page doesn't edit → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "acct-1" }));
  });

  it("fires once, even after a parent re-render with fresh inline props", async () => {
    const utils = renderFocused({ kind: "client_deduction", id: "ded-1" });
    await expectUnavailable(utils);

    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <AssumptionsClient
          {...PROPS}
          focus={{ kind: "client_deduction", id: "ded-1" }}
          onFocusClose={utils.onFocusClose}
        />
      </ClientAccessProvider>,
    );
    expect(utils.onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("without focus the page renders as before — the Deductions tab lists the row", () => {
    renderView();

    expect(screen.getByText("First Baptist Church")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit First Baptist Church" })).toBeTruthy();
  });
});
