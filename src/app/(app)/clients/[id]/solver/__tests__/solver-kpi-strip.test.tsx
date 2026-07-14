// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverKpiStrip } from "../solver-kpi-strip";

describe("SolverKpiStrip", () => {
  const base = {
    posState: "ready" as const,
    workingSuccess: 0.88,
    baselineSuccess: 0.84,
    endingAssets: 11_500_000,
    endingAssetsDelta: 1_610_000,
    portfolioAtRetirement: 8_200_000,
    portfolioAtRetirementDelta: 640_000,
    showPortfolioAtRetirement: true,
    yearsFunded: 45,
    yearsFundedDelta: 0,
    lifetimeTax: 4_010_000,
    lifetimeTaxDelta: 386_000,
    netToHeirs: 2_400_000,
    netToHeirsDelta: 180_000,
    netToHeirsLoading: false,
    dimmed: false,
    onRegenerate: () => {},
    solveActive: false,
  };

  it("renders the scenario success percentage", () => {
    render(<SolverKpiStrip {...base} />);
    expect(screen.getByText(/88%/)).toBeTruthy();
  });

  it("renders the base sub-hint on the gauge", () => {
    render(<SolverKpiStrip {...base} />);
    expect(screen.getByText(/from 84%/)).toBeTruthy();
  });

  it("still renders the base sub-hint when the gauge is stale", () => {
    // The sub-hint gate is `ready || stale` — an edited (stale) scenario keeps
    // showing the delta from base until the recompute lands.
    render(<SolverKpiStrip {...base} posState="stale" />);
    expect(screen.getByText(/from 84%/)).toBeTruthy();
  });

  it("renders the Total to Heirs tile with its vs-Base delta", () => {
    render(<SolverKpiStrip {...base} />);
    expect(screen.getByText(/Total to Heirs/)).toBeTruthy();
    expect(screen.getByText(/\$2\.40M/)).toBeTruthy();
    expect(screen.getByText(/\+\$180,000 vs Base/)).toBeTruthy();
  });

  it("shows a loading placeholder for Total to Heirs before the estate fetch resolves", () => {
    render(<SolverKpiStrip {...base} netToHeirs={null} netToHeirsDelta={null} netToHeirsLoading />);
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("renders the Portfolio at Retirement tile with its vs-Base delta when applicable", () => {
    render(<SolverKpiStrip {...base} />);
    expect(screen.getByText(/Portfolio at Retirement/)).toBeTruthy();
    expect(screen.getByText(/\$8\.20M/)).toBeTruthy();
    expect(screen.getByText(/\+\$640,000 vs Base/)).toBeTruthy();
  });

  it("omits the Portfolio at Retirement tile when the client is already retired", () => {
    render(<SolverKpiStrip {...base} showPortfolioAtRetirement={false} />);
    expect(screen.queryByText(/Portfolio at Retirement/)).toBeNull();
  });
});
