// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData, ProjectionYear } from "@/engine";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "@/lib/solver/types";
import type { ReportKey } from "../report-tab-link";
import {
  resolveReportLayout,
  REPORT_KEYS,
  type ReportLayoutEntry,
} from "@/lib/solver/report-layout";

vi.mock("@/components/charts/portfolio-bars-chart", () => ({
  PortfolioBarsChart: () => <div data-testid="chart-portfolio" />,
  liquidPortfolioTotal: () => 0,
}));
vi.mock("@/components/charts/solver-cash-flow-chart", () => ({
  SolverCashFlowChart: () => <div data-testid="chart-cashflow" />,
}));
vi.mock("@/components/yearly-liquidity-chart", () => ({
  YearlyLiquidityChart: ({ showPortfolio }: { showPortfolio: boolean }) => (
    <div data-testid="chart-liquidity">portfolio:{String(showPortfolio)}</div>
  ),
}));
vi.mock("@/lib/estate/yearly-liquidity-report", () => ({
  buildYearlyLiquidityReport: () => ({ rows: [] }),
}));
vi.mock("../li-need-over-time-view", () => ({
  LiNeedOverTimeView: () => <div data-testid="chart-li-need" />,
}));
// The hook now auto-runs its solve fetch when the Life Insurance Need report
// is active — stub it so activating that tab stays network-free here.
vi.mock("../use-need-over-time", () => ({
  useNeedOverTime: () => ({
    rows: null,
    isRunning: false,
    progress: null,
    errorMessage: null,
  }),
}));
vi.mock("@/components/charts/estate-comparison-chart", () => ({
  EstateComparisonChart: () => <div data-testid="chart-estate" />,
}));
vi.mock("../solver-summary-panel", () => ({
  SolverSummaryPanel: () => <div data-testid="solver-summary-panel" />,
}));
vi.mock("@/components/cashflow/charts/tax-bracket-chart", () => ({
  TaxBracketChart: () => <div data-testid="chart-tax-bracket" />,
}));
// Renders the `thresholds` slot rather than dropping it — otherwise the
// assertion below that the solver still wires its Thresholds panel into the
// Taxes report would be vacuous: a mock that ignores the prop stays green no
// matter what the panel passes (or stops passing).
vi.mock("@/components/cashflow/tax-bracket-tab", () => ({
  TaxBracketTab: ({ thresholds }: { thresholds?: React.ReactNode }) => (
    <div data-testid="table-tax-bracket">{thresholds}</div>
  ),
}));
vi.mock("@/components/charts/solver-withdrawal-chart", () => ({
  SolverWithdrawalChart: ({ rows }: { rows: { year: number }[] }) => (
    <div data-testid="chart-withdrawals">rows:{rows.length}</div>
  ),
}));
// Renders `rows` so the assertions below can tell a wired-up panel from one
// that was handed the empty array the non-Withdrawals branches pass.
vi.mock("../solver-withdrawal-panel", () => ({
  SolverWithdrawalPanel: ({ rows }: { rows: { year: number }[] }) => (
    <div data-testid="table-withdrawals">rows:{rows.length}</div>
  ),
}));
// The real row builder runs (importOriginal), wrapped so the "built only while
// the Monthly sub-tab is open" claim in the panel is a checked one. A mock that
// merely returned rows could not tell a lazy build from an eager one.
const buildMonthlyRows = vi.hoisted(() => vi.fn());
vi.mock("@/lib/solver/monthly-cash-flow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solver/monthly-cash-flow")>();
  buildMonthlyRows.mockImplementation(actual.buildMonthlyCashFlowRows);
  return { ...actual, buildMonthlyCashFlowRows: buildMonthlyRows };
});
vi.mock("@/components/charts/solver-monthly-cash-flow-chart", () => ({
  SolverMonthlyCashFlowChart: ({ rows }: { rows: { year: number }[] }) => (
    <div data-testid="chart-monthly">rows:{rows.length}</div>
  ),
}));
// Renders `rows` and `basis`, and offers a control that calls `onBasisChange`,
// so the assertions can tell a wired-up panel from one handed the empty array
// the other sub-tabs pass or a dead callback — same reasoning as the
// withdrawal-panel mock above.
vi.mock("../solver-monthly-cash-flow-panel", async (importActual) => ({
  // `selectMonthlyRow` keeps its REAL implementation. It is the panel's own
  // year-selection rule and this panel's month lookup runs through it, so a stub
  // would let a wrong-year regression pass this file unseen. Only the component
  // is replaced.
  selectMonthlyRow: (await importActual<typeof import("../solver-monthly-cash-flow-panel")>())
    .selectMonthlyRow,
  SolverMonthlyCashFlowPanel: ({
    rows,
    basis,
    onBasisChange,
  }: {
    rows: { year: number }[];
    basis: string;
    onBasisChange: (b: string) => void;
  }) => (
    <div data-testid="panel-monthly">
      rows:{rows.length} basis:{basis}
      <button type="button" onClick={() => onBasisChange(basis === "today" ? "nominal" : "today")}>
        flip basis
      </button>
    </div>
  ),
}));
vi.mock("../solver-monte-carlo-panel", () => ({
  SolverMonteCarloPanel: () => <div data-testid="solver-mc-panel" />,
}));
vi.mock("../solver-balance-sheet-panel", () => ({
  SolverBalanceSheetPanel: () => <div data-testid="solver-balance-sheet-panel" />,
}));
vi.mock("../solver-thresholds-panel", () => ({
  SolverThresholdsPanel: () => <div data-testid="solver-thresholds-panel" />,
}));
vi.mock("@/components/estate-flow-chart-tab", () => ({
  EstateFlowChartTab: ({
    isMarried,
    workingGifts,
  }: {
    isMarried: boolean;
    workingGifts: { id: string }[];
  }) => (
    <div data-testid="estate-flow-chart">
      married:{String(isMarried)} gifts:{workingGifts.length}
    </div>
  ),
}));

// Controllable stub for the projection fetch, so the flow branch renders
// network-free and each state (loaded / loading / failed) is reachable.
const fullProjectionStub = {
  current: { projection: { years: [] } as unknown, loading: false },
};
vi.mock("../use-solver-full-projection", () => ({
  useSolverFullProjection: () => fullProjectionStub.current,
}));

import { SolverChartPanel, REPORT_TABS, type CashflowSubTab } from "../solver-chart-panel";

const workingTree = {
  client: {
    firstName: "Pat",
    lastName: "Lee",
    dateOfBirth: "1960-01-01",
  },
  accounts: [],
  // The month allocator reads all three lists to find each row's chosen payment
  // month. They are required on ClientData, so a real working tree always has
  // them; this stub predates the allocator and needs them spelled out.
  incomes: [],
  expenses: [],
  liabilities: [],
  // The Monthly sub-tab's row builder deflates every figure to plan-start
  // dollars, so it reads these two off the working tree.
  planSettings: { inflationRate: 0.03, planStartYear: 2026 },
} as unknown as ClientData;

// Two years, enough for the Withdrawals sub-tab's row builder to produce something
// distinguishable from the empty default the other reports render with.
const withdrawalProjection = [2026, 2027].map(
  (year) =>
    ({
      year,
      ages: { client: 66 },
      income: { socialSecurity: 0, salaries: 0, bySource: {} },
      withdrawals: { byAccount: {}, total: 0 },
      accountLedgers: {},
      // Every bucket the Monthly row builder reads, not just `living`: a
      // missing one makes that fixed cost NaN, and a missing `savings` throws.
      // `bySource`/`byLiability` are for the month ALLOCATOR, which walks them to
      // place each row in its chosen month — it throws outright on undefined.
      expenses: {
        living: 0,
        taxes: 0,
        liabilities: 0,
        insurance: 0,
        realEstate: 0,
        other: 0,
        discretionary: 0,
        bySource: {},
        byLiability: {},
      },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      portfolioAssets: { liquidTotal: 0 },
      totalIncome: 0,
      totalExpenses: 0,
      netCashFlow: 0,
    }) as unknown as ProjectionYear,
);

const liAssumptions = {} as LiAssumptions;

// Mirrors the fixture builder in src/lib/solver/__tests__/working-gifts.test.ts.
function cashGift(id: string, year: number, amount: number): EstateFlowGift {
  return {
    kind: "cash-once",
    id,
    year,
    amount,
    grantor: "client",
    recipient: { kind: "family_member", id: "fm-1" },
    crummey: false,
  };
}

// Controlled host: the panel now reads its active tab from `activeReport` and
// reports clicks via `onReportChange`. This wrapper holds that state locally so
// the tests can drive the panel exactly as the workspace does.
function ControlledPanel({
  initialReport = "portfolio",
  computeStatus = "fresh",
  layout,
  onLayoutChange,
  baseGifts = [],
  mutations = [],
  currentProjection = [] as ProjectionYear[],
}: {
  initialReport?: ReportKey;
  computeStatus?: "fresh" | "stale" | "computing" | "error";
  layout?: ReportLayoutEntry[];
  onLayoutChange?: (next: ReportLayoutEntry[]) => void;
  baseGifts?: EstateFlowGift[];
  mutations?: SolverMutation[];
  currentProjection?: ProjectionYear[];
}) {
  const [activeReport, setActiveReport] = useState<ReportKey>(initialReport);
  const [cashflowSubTab, setCashflowSubTab] = useState<CashflowSubTab>("cashflow");
  return (
    <SolverChartPanel
      currentProjection={currentProjection}
      firstDeathYear={null}
      baseProjection={[] as ProjectionYear[]}
      workingTree={workingTree}
      baseTree={workingTree}
      computeStatus={computeStatus}
      clientId="client-1"
      liAssumptions={liAssumptions}
      liModelPortfolioLabel="Plan default rate"
      clientName="Pat"
      spouseName="Spouse"
      activeReport={activeReport}
      onReportChange={setActiveReport}
      source="base"
      mutations={mutations}
      mcSuccessRate={null}
      extraAccountMixes={[]}
      mcNonce={0}
      mcRequested={false}
      activeSummary="retirement"
      onSummaryChange={() => undefined}
      cashflowSubTab={cashflowSubTab}
      onCashflowSubTabChange={setCashflowSubTab}
      selectedYear={null}
      onYearClick={() => undefined}
      layout={layout}
      onLayoutChange={onLayoutChange}
      baseGifts={baseGifts}
    />
  );
}

describe("SolverChartPanel", () => {
  beforeEach(() => {
    fullProjectionStub.current = { projection: { years: [] }, loading: false };
    buildMonthlyRows.mockClear();
  });

  it("shows the Portfolio chart by default", () => {
    render(<ControlledPanel />);
    expect(screen.getByTestId("chart-portfolio")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-cashflow")).not.toBeInTheDocument();
  });

  it("renders all five report tabs unconditionally", () => {
    render(<ControlledPanel />);
    for (const name of [
      "Portfolio",
      "Cash Flow",
      "Tax Bracket",
      "Life Insurance Need",
      "Estate",
      "Balance Sheet",
    ]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    // Liquidity is no longer its own tab — it lives inside the Estate report.
    expect(screen.queryByRole("tab", { name: "Liquidity" })).not.toBeInTheDocument();
  });

  it("switches to the Cash Flow chart", async () => {
    render(<ControlledPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    expect(screen.getByTestId("chart-cashflow")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-portfolio")).not.toBeInTheDocument();
  });

  it("offers Cash Flow and Withdrawals sub-tabs on the Cash Flow report, defaulting to Cash Flow", async () => {
    render(<ControlledPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));

    expect(screen.getByRole("button", { name: "Withdrawals" })).toBeInTheDocument();
    // Default sub-tab: the existing cash-flow chart, behind the expand toggle.
    expect(screen.getByTestId("chart-cashflow")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-withdrawals")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  it("swaps chart and table together on the Withdrawals sub-tab, and drops the expand toggle", async () => {
    render(<ControlledPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdrawals" }));

    expect(screen.getByTestId("chart-withdrawals")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-cashflow")).not.toBeInTheDocument();
    // The table is part of the report here, so it needs no expand control.
    expect(screen.getByTestId("table-withdrawals")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand table" }),
    ).not.toBeInTheDocument();
  });

  it("feeds the same built rows to both the Withdrawals chart and its table", async () => {
    render(<ControlledPanel currentProjection={withdrawalProjection} />);
    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdrawals" }));

    // `rows:0` here would mean the memo's gate never opened for one of them.
    expect(screen.getByTestId("chart-withdrawals")).toHaveTextContent("rows:2");
    expect(screen.getByTestId("table-withdrawals")).toHaveTextContent("rows:2");
  });

  it("returns to the cash-flow chart when the Cash Flow sub-tab is re-selected", async () => {
    render(<ControlledPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdrawals" }));
    await userEvent.click(screen.getByRole("button", { name: "Cash Flow" }));

    expect(screen.getByTestId("chart-cashflow")).toBeInTheDocument();
    expect(screen.queryByTestId("table-withdrawals")).not.toBeInTheDocument();
  });

  it("switches to the Tax Bracket chart and shows its table inline", async () => {
    render(<ControlledPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "Tax Bracket" }));
    expect(screen.getByTestId("chart-tax-bracket")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-portfolio")).not.toBeInTheDocument();
    // The bracket tables ARE the details view — not the generic year table —
    // so this report shows them at all times and carries no expand toggle.
    expect(screen.getByTestId("table-tax-bracket")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /expand table/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the liquidity chart inside Estate and toggles portfolio assets", async () => {
    render(<ControlledPanel initialReport="estate" />);
    // Estate now renders both charts side by side.
    expect(screen.getByTestId("chart-estate")).toBeInTheDocument();
    expect(screen.getByTestId("chart-liquidity")).toHaveTextContent(
      "portfolio:false",
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: /show portfolio assets/i }),
    );
    expect(screen.getByTestId("chart-liquidity")).toHaveTextContent(
      "portfolio:true",
    );
  });

  it("keeps the resize handle on every tab, including Estate", async () => {
    render(<ControlledPanel />);
    const handle = () =>
      screen.getByRole("separator", { name: /resize chart height/i });
    // Default (portfolio) tab.
    expect(handle()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Estate" }));
    expect(handle()).toBeInTheDocument();
  });

  it("shows the resize handle on the Life Insurance Need tab", () => {
    render(<ControlledPanel initialReport="lifeInsurance" />);
    expect(
      screen.getByRole("separator", { name: /resize chart height/i }),
    ).toBeInTheDocument();
  });

  it("shows the recalculating hint while computing", () => {
    render(<ControlledPanel computeStatus="computing" />);
    expect(screen.getByText(/recalculating/i)).toBeInTheDocument();
  });

  it("renders the Life Insurance Need view when that report is active", () => {
    render(<ControlledPanel initialReport="lifeInsurance" />);
    const tab = screen.getByRole("tab", { name: "Life Insurance Need" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chart-li-need")).toBeInTheDocument();
  });

  it("renders both the Estate and liquidity charts when Estate is active", () => {
    render(<ControlledPanel initialReport="estate" />);
    const tab = screen.getByRole("tab", { name: "Estate" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chart-estate")).toBeInTheDocument();
    expect(screen.getByTestId("chart-liquidity")).toBeInTheDocument();
  });

  it("renders the Monte Carlo report panel when that tab is active", () => {
    render(<ControlledPanel initialReport="monteCarlo" />);
    expect(screen.getByRole("tab", { name: "Monte Carlo" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("solver-mc-panel")).toBeInTheDocument();
  });

  it("reports tab clicks through onReportChange", async () => {
    const onReportChange = vi.fn();
    render(
      <SolverChartPanel
        currentProjection={[] as ProjectionYear[]}
        firstDeathYear={null}
        baseProjection={[] as ProjectionYear[]}
        workingTree={workingTree}
        baseTree={workingTree}
        computeStatus="fresh"
        clientId="client-1"
        liAssumptions={liAssumptions}
        liModelPortfolioLabel="Plan default rate"
        clientName="Pat"
        spouseName="Spouse"
        activeReport="portfolio"
        onReportChange={onReportChange}
        source="base"
        mutations={[]}
        mcSuccessRate={null}
        extraAccountMixes={[]}
        mcNonce={0}
        mcRequested={false}
        activeSummary="retirement"
        onSummaryChange={() => undefined}
        cashflowSubTab="cashflow"
        onCashflowSubTabChange={() => undefined}
        selectedYear={null}
        onYearClick={() => undefined}
        baseGifts={[]}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Estate" }));
    expect(onReportChange).toHaveBeenCalledWith("estate");
  });

  it("renders the Balance Sheet panel when that tab is active", () => {
    render(<ControlledPanel initialReport="balanceSheet" />);
    expect(screen.getByRole("tab", { name: "Balance Sheet" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("solver-balance-sheet-panel")).toBeInTheDocument();
  });

  // Thresholds is no longer a report of its own — it's a scope inside the
  // Taxes report, reached through that report's Federal/State group. Both
  // halves matter: the strip must not carry a Thresholds tab, and the panel
  // must still reach TaxBracketTab's slot. All 12 tests in
  // solver-thresholds-panel.test.tsx render the panel DIRECTLY and so bypass
  // this wiring entirely — drop the `thresholds` prop below and this is the
  // only test that reddens.
  it("hands the Thresholds panel to the Taxes report instead of giving it a tab", () => {
    render(<ControlledPanel initialReport="taxBracket" />);
    expect({
      ownTab: screen.queryByRole("tab", { name: "Thresholds" }) !== null,
      slotFilled: screen.queryByTestId("solver-thresholds-panel") !== null,
    }).toEqual({ ownTab: false, slotFilled: true });
  });

  it("renders only visible tabs, in layout order", () => {
    // Hide Cash Flow; move Monte Carlo to the front.
    const layout = resolveReportLayout([
      { id: "monteCarlo", visible: true },
      { id: "portfolio", visible: true },
      { id: "cashflow", visible: false },
    ]);
    render(
      <ControlledPanel
        initialReport="monteCarlo"
        layout={layout}
        onLayoutChange={() => undefined}
      />,
    );
    // Cash Flow is hidden.
    expect(
      screen.queryByRole("tab", { name: "Cash Flow" }),
    ).not.toBeInTheDocument();
    // Monte Carlo tab is present (visible) and first in the strip.
    const tabNames = screen
      .getAllByRole("tab")
      .map((t) => t.getAttribute("aria-label"));
    expect(tabNames[0]).toBe("Monte Carlo");
    expect(tabNames).not.toContain("Cash Flow");
  });

  it("shows the customize gear only when onLayoutChange is provided", () => {
    const { unmount } = render(<ControlledPanel />);
    expect(
      screen.queryByRole("button", { name: /customize reports/i }),
    ).not.toBeInTheDocument();
    unmount();
    render(<ControlledPanel onLayoutChange={() => undefined} />);
    expect(
      screen.getByRole("button", { name: /customize reports/i }),
    ).toBeInTheDocument();
  });

  it("keeps REPORT_TABS ordered identically to REPORT_KEYS", () => {
    expect(REPORT_TABS.map((t) => t.id)).toEqual([...REPORT_KEYS]);
  });

  it("closes the customize popover when the gear is clicked a second time", async () => {
    render(<ControlledPanel onLayoutChange={() => undefined} />);
    const gear = screen.getByRole("button", { name: /customize reports/i });
    await userEvent.click(gear);
    expect(
      screen.getByRole("dialog", { name: /customize reports/i }),
    ).toBeInTheDocument();
    // The gear must act as a toggle. The popover closes on any outside
    // mousedown; without a guard on the gear, its own mousedown closes the
    // popover and the ensuing click immediately reopens it, so it could never
    // be dismissed by clicking the gear again.
    await userEvent.click(gear);
    expect(
      screen.queryByRole("dialog", { name: /customize reports/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Charts and Flow Chart sub-tabs on Estate, defaulting to Charts", () => {
    render(<ControlledPanel initialReport="estate" />);
    expect(screen.getByRole("button", { name: "Charts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flow Chart" })).toBeInTheDocument();
    // Default sub-tab is Charts — both existing charts still render.
    expect(screen.getByTestId("chart-estate")).toBeInTheDocument();
    expect(screen.getByTestId("chart-liquidity")).toBeInTheDocument();
    expect(screen.queryByTestId("estate-flow-chart")).not.toBeInTheDocument();
  });

  it("shows no estate sub-tabs on other reports", () => {
    render(<ControlledPanel initialReport="portfolio" />);
    expect(screen.queryByRole("button", { name: "Flow Chart" })).not.toBeInTheDocument();
  });

  it("swaps the body and drops the Charts-only chrome on the Flow Chart sub-tab", async () => {
    const baseGifts = [cashGift("g1", 2026, 1000)];
    render(<ControlledPanel initialReport="estate" baseGifts={baseGifts} />);
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));

    // next/dynamic resolves asynchronously — find, don't get.
    const chart = await screen.findByTestId("estate-flow-chart");
    expect(chart).toBeInTheDocument();
    // The mock renders `gifts:{workingGifts.length}` — this proves the panel
    // actually derives workingGifts from baseGifts (deriveWorkingGifts),
    // rather than the memo silently collapsing to [].
    expect(chart).toHaveTextContent("gifts:1");
    expect(screen.queryByTestId("chart-estate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart-liquidity")).not.toBeInTheDocument();

    // The three Charts-only controls are gone with the fixed-height box.
    expect(
      screen.queryByRole("checkbox", { name: /show portfolio assets/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /expand table/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: /resize chart height/i }),
    ).not.toBeInTheDocument();
  });

  it("folds a gift-upsert mutation into the Flow Chart's workingGifts", async () => {
    const baseGifts = [cashGift("g1", 2026, 1000)];
    const mutations: SolverMutation[] = [
      { kind: "gift-upsert", id: "g2", value: cashGift("g2", 2027, 2000) },
    ];
    render(
      <ControlledPanel
        initialReport="estate"
        baseGifts={baseGifts}
        mutations={mutations}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));
    // g2 isn't in baseGifts, so the fold appends it — exercising
    // deriveWorkingGifts itself, not just the pass-through of baseGifts.
    expect(await screen.findByTestId("estate-flow-chart")).toHaveTextContent(
      "gifts:2",
    );
  });

  it("returns to the charts when Charts is re-selected", async () => {
    render(<ControlledPanel initialReport="estate" />);
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));
    expect(await screen.findByTestId("estate-flow-chart")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Charts" }));
    expect(screen.getByTestId("chart-estate")).toBeInTheDocument();
    expect(screen.queryByTestId("estate-flow-chart")).not.toBeInTheDocument();
  });

  it("keeps the report tab strip usable from the Flow Chart sub-tab", async () => {
    render(<ControlledPanel initialReport="estate" />);
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));
    expect(await screen.findByTestId("estate-flow-chart")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Portfolio" }));
    expect(screen.getByTestId("chart-portfolio")).toBeInTheDocument();
  });

  it("shows a loading state while the full projection is in flight", async () => {
    fullProjectionStub.current = { projection: undefined, loading: true };
    render(<ControlledPanel initialReport="estate" />);
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));
    expect(await screen.findByText(/loading estate flow/i)).toBeInTheDocument();
    expect(screen.queryByTestId("estate-flow-chart")).not.toBeInTheDocument();
  });

  it("shows an unavailable message when the projection could not be built", async () => {
    fullProjectionStub.current = { projection: undefined, loading: false };
    render(<ControlledPanel initialReport="estate" />);
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));
    expect(
      await screen.findByText(/estate flow is unavailable/i),
    ).toBeInTheDocument();
  });

  // Pins the re-fetch invariant: a lever move (e.g. a life-expectancy stepper)
  // re-fires the debounced fetch — `loading: true` — while the PREVIOUS
  // projection is still around; the chart must stay on screen rather than
  // blank to a spinner. solver-chart-panel.tsx now guarantees this two ways:
  // the ternary checks `fullProjection` first, AND `flowSpinner` itself
  // already folds in `!fullProjection`, so a bare ternary-order inversion is
  // a no-op against this stub (`flowSpinner` still evaluates false when
  // `fullProjection` is truthy, regardless of which branch is checked first).
  // What *does* redden this (and only this) case is undoing BOTH: weakening
  // `flowSpinner` back to plain `flowLoading` AND checking it before
  // `fullProjection` — i.e. reverting the whole invariant, not just its
  // ternary order.
  it("keeps the flow chart on screen during a re-fetch instead of blanking to a spinner", async () => {
    fullProjectionStub.current = { projection: { years: [] }, loading: true };
    render(<ControlledPanel initialReport="estate" />);
    await userEvent.click(screen.getByRole("button", { name: "Flow Chart" }));
    expect(await screen.findByTestId("estate-flow-chart")).toBeInTheDocument();
    expect(screen.queryByText(/loading estate flow/i)).not.toBeInTheDocument();
  });

  it("offers a Monthly sub-tab under Cash Flow", () => {
    render(<ControlledPanel initialReport="cashflow" />);
    expect(screen.getByRole("button", { name: "Monthly" })).toBeInTheDocument();
  });

  it("does not offer the Monthly sub-tab on other reports", () => {
    render(<ControlledPanel initialReport="portfolio" />);
    expect(screen.queryByRole("button", { name: "Monthly" })).not.toBeInTheDocument();
  });

  it("renders the monthly chart and panel when the Monthly sub-tab is chosen", async () => {
    render(<ControlledPanel initialReport="cashflow" currentProjection={withdrawalProjection} />);
    await userEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByTestId("chart-monthly")).toHaveTextContent("rows:2");
    expect(screen.getByTestId("panel-monthly")).toHaveTextContent("rows:2");
  });

  // Two directions in one case, and it ends on the basis it started with: the
  // store behind this is module-level, so a test that flipped it and walked
  // away would decide what the next test sees.
  it("hands the monthly panel today's dollars, and takes its choice back", async () => {
    render(<ControlledPanel initialReport="cashflow" currentProjection={withdrawalProjection} />);
    await userEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByTestId("panel-monthly")).toHaveTextContent("basis:today");

    await userEvent.click(screen.getByRole("button", { name: "flip basis" }));
    expect(screen.getByTestId("panel-monthly")).toHaveTextContent("basis:nominal");

    await userEvent.click(screen.getByRole("button", { name: "flip basis" }));
    expect(screen.getByTestId("panel-monthly")).toHaveTextContent("basis:today");
  });

  it("builds no monthly rows while a different sub-tab is open", () => {
    render(<ControlledPanel initialReport="cashflow" currentProjection={withdrawalProjection} />);
    expect(buildMonthlyRows).not.toHaveBeenCalled();
  });
});
