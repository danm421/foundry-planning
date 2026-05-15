// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData, ProjectionYear } from "@/engine";

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

import { SolverChartPanel } from "../solver-chart-panel";

const workingTree = {
  client: {
    firstName: "Pat",
    lastName: "Lee",
    dateOfBirth: "1960-01-01",
  },
} as unknown as ClientData;

function renderPanel() {
  return render(
    <SolverChartPanel
      currentProjection={[] as ProjectionYear[]}
      baseProjection={[] as ProjectionYear[]}
      workingTree={workingTree}
      computeStatus="fresh"
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

  it("shows the recalculating hint while computing", () => {
    render(
      <SolverChartPanel
        currentProjection={[] as ProjectionYear[]}
        baseProjection={[] as ProjectionYear[]}
        workingTree={workingTree}
        computeStatus="computing"
      />,
    );
    expect(screen.getByText(/recalculating/i)).toBeInTheDocument();
  });
});
