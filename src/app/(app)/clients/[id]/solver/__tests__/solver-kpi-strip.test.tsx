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
    yearsFunded: 45,
    yearsFundedDelta: 0,
    lifetimeTax: 4_010_000,
    lifetimeTaxDelta: 386_000,
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
});
