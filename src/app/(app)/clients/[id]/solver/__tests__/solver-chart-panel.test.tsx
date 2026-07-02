// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData, ProjectionYear } from "@/engine";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { ReportKey } from "../report-tab-link";

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
vi.mock("@/components/charts/estate-comparison-chart", () => ({
  EstateComparisonChart: () => <div data-testid="chart-estate" />,
}));
vi.mock("../solver-summary-panel", () => ({
  SolverSummaryPanel: () => <div data-testid="solver-summary-panel" />,
}));
vi.mock("@/components/cashflow/charts/tax-bracket-chart", () => ({
  TaxBracketChart: () => <div data-testid="chart-tax-bracket" />,
}));
vi.mock("@/components/cashflow/tax-bracket-tab", () => ({
  TaxBracketTab: () => <div data-testid="table-tax-bracket" />,
}));
vi.mock("../solver-monte-carlo-panel", () => ({
  SolverMonteCarloPanel: () => <div data-testid="solver-mc-panel" />,
}));

import { SolverChartPanel } from "../solver-chart-panel";

const workingTree = {
  client: {
    firstName: "Pat",
    lastName: "Lee",
    dateOfBirth: "1960-01-01",
  },
} as unknown as ClientData;

const liAssumptions = {} as LiAssumptions;

// Controlled host: the panel now reads its active tab from `activeReport` and
// reports clicks via `onReportChange`. This wrapper holds that state locally so
// the tests can drive the panel exactly as the workspace does.
function ControlledPanel({
  initialReport = "portfolio",
  computeStatus = "fresh",
}: {
  initialReport?: ReportKey;
  computeStatus?: "fresh" | "stale" | "computing" | "error";
}) {
  const [activeReport, setActiveReport] = useState<ReportKey>(initialReport);
  return (
    <SolverChartPanel
      currentProjection={[] as ProjectionYear[]}
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
      mutations={[]}
      mcSuccessRate={null}
      extraAccountMixes={[]}
      mcNonce={0}
      mcRequested={false}
      activeSummary="retirement"
      onSummaryChange={() => undefined}
      selectedYear={null}
      onYearClick={() => undefined}
    />
  );
}

describe("SolverChartPanel", () => {
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

  it("switches to the Tax Bracket chart and shows its table when expanded", async () => {
    render(<ControlledPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "Tax Bracket" }));
    expect(screen.getByTestId("chart-tax-bracket")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-portfolio")).not.toBeInTheDocument();
    // The bracket tables ARE the details view — not the generic year table.
    await userEvent.click(screen.getByRole("button", { name: /expand table/i }));
    expect(screen.getByTestId("table-tax-bracket")).toBeInTheDocument();
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
        selectedYear={null}
        onYearClick={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Estate" }));
    expect(onReportChange).toHaveBeenCalledWith("estate");
  });
});
