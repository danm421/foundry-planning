// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData, ProjectionYear } from "@/engine";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

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

import { SolverChartPanel } from "../solver-chart-panel";

const workingTree = {
  client: {
    firstName: "Pat",
    lastName: "Lee",
    dateOfBirth: "1960-01-01",
  },
} as unknown as ClientData;

const liAssumptions = {} as LiAssumptions;

function renderPanel(
  overrides: { showLifeInsuranceTab?: boolean; showEstateTab?: boolean } = {},
) {
  return render(
    <SolverChartPanel
      currentProjection={[] as ProjectionYear[]}
      baseProjection={[] as ProjectionYear[]}
      workingTree={workingTree}
      baseTree={workingTree}
      computeStatus="fresh"
      clientId="client-1"
      liAssumptions={liAssumptions}
      clientName="Pat"
      spouseName="Spouse"
      showLifeInsuranceTab={overrides.showLifeInsuranceTab ?? false}
      showEstateTab={overrides.showEstateTab ?? false}
    />,
  );
}

describe("SolverChartPanel", () => {
  it("shows the Portfolio chart by default", () => {
    renderPanel();
    expect(screen.getByTestId("chart-portfolio")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-cashflow")).not.toBeInTheDocument();
  });

  it("switches to the Cash Flow chart", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    expect(screen.getByTestId("chart-cashflow")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-portfolio")).not.toBeInTheDocument();
  });

  it("switches to Liquidity and toggles portfolio assets", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("tab", { name: "Liquidity" }));
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

  it("keeps the resize handle on every tab, including liquidity", async () => {
    renderPanel();
    const handle = () =>
      screen.getByRole("separator", { name: /resize chart height/i });
    // Default (portfolio) tab.
    expect(handle()).toBeInTheDocument();
    // Liquidity used to render with its own fixed height and no handle.
    await userEvent.click(screen.getByRole("tab", { name: "Liquidity" }));
    expect(handle()).toBeInTheDocument();
  });

  it("shows the resize handle on the Life Insurance Need tab", () => {
    renderPanel({ showLifeInsuranceTab: true });
    expect(
      screen.getByRole("separator", { name: /resize chart height/i }),
    ).toBeInTheDocument();
  });

  it("shows the recalculating hint while computing", () => {
    render(
      <SolverChartPanel
        currentProjection={[] as ProjectionYear[]}
        baseProjection={[] as ProjectionYear[]}
        workingTree={workingTree}
        baseTree={workingTree}
        computeStatus="computing"
        clientId="client-1"
        liAssumptions={liAssumptions}
        clientName="Pat"
        spouseName="Spouse"
        showLifeInsuranceTab={false}
        showEstateTab={false}
      />,
    );
    expect(screen.getByText(/recalculating/i)).toBeInTheDocument();
  });

  it("hides the Life Insurance Need tab when not on the LI solver tab", () => {
    renderPanel({ showLifeInsuranceTab: false });
    expect(
      screen.queryByRole("tab", { name: "Life Insurance Need" }),
    ).not.toBeInTheDocument();
  });

  it("shows and auto-selects the Life Insurance Need tab when active", () => {
    renderPanel({ showLifeInsuranceTab: true });
    const tab = screen.getByRole("tab", { name: "Life Insurance Need" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chart-li-need")).toBeInTheDocument();
  });

  it("shows and auto-selects the Estate tab when active", () => {
    renderPanel({ showEstateTab: true });
    const tab = screen.getByRole("tab", { name: "Estate" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chart-estate")).toBeInTheDocument();
  });

  it("auto-selects LI tab on enter, keeps it switchable, hides it on leave", async () => {
    const baseProps = {
      currentProjection: [] as ProjectionYear[],
      baseProjection: [] as ProjectionYear[],
      workingTree,
      baseTree: workingTree,
      computeStatus: "fresh" as const,
      clientId: "client-1",
      liAssumptions,
      clientName: "Pat",
      spouseName: "Spouse",
      showEstateTab: false,
    };

    // 1. Start with LI tab hidden — Portfolio chart is shown, no LI tab present.
    const { rerender } = render(
      <SolverChartPanel {...baseProps} showLifeInsuranceTab={false} />,
    );
    expect(
      screen.queryByRole("tab", { name: "Life Insurance Need" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-portfolio")).toBeInTheDocument();

    // 2. Show LI tab — it should be auto-selected and its chart rendered.
    rerender(<SolverChartPanel {...baseProps} showLifeInsuranceTab={true} />);
    const liTab = screen.getByRole("tab", { name: "Life Insurance Need" });
    expect(liTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chart-li-need")).toBeInTheDocument();

    // 3. While LI tab is visible, user manually switches to Portfolio — proves the
    //    LI tab is auto-selected on enter but not locked.
    await userEvent.click(screen.getByRole("tab", { name: "Portfolio" }));
    expect(screen.getByTestId("chart-portfolio")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Life Insurance Need" }),
    ).toHaveAttribute("aria-selected", "false");

    // 4. Hide LI tab — user was on Portfolio, so no revert needed; Portfolio
    //    chart remains and the LI tab disappears entirely.
    rerender(<SolverChartPanel {...baseProps} showLifeInsuranceTab={false} />);
    expect(
      screen.queryByRole("tab", { name: "Life Insurance Need" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-portfolio")).toBeInTheDocument();
  });
});
