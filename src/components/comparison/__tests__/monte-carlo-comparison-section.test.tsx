// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonteCarloComparisonSection } from "../monte-carlo-comparison-section";

vi.mock("@/components/monte-carlo/fan-chart", () => ({
  FanChart: () => <div data-testid="fan-chart" />,
}));
vi.mock("@/components/monte-carlo/success-gauge", () => ({
  SuccessGauge: ({ value }: { value: number }) => (
    <div data-testid="gauge">{value}</div>
  ),
}));

function fakePlanMc(label: string, successRate: number) {
  return {
    planId: label,
    label,
    successRate,
    summary: { ending: { p50: 1_000_000, p20: 600_000 } } as never,
    result: { successRate } as never,
  };
}

describe("MonteCarloComparisonSection (N gauges)", () => {
  it("renders one gauge per plan at N=2", () => {
    render(
      <MonteCarloComparisonSection
        plansMc={[fakePlanMc("Base", 0.9), fakePlanMc("B", 0.85)]}
      />,
    );
    expect(screen.getAllByTestId("gauge")).toHaveLength(2);
  });

  it("renders 4 gauges at N=4", () => {
    render(
      <MonteCarloComparisonSection
        plansMc={[
          fakePlanMc("Base", 0.9),
          fakePlanMc("A", 0.8),
          fakePlanMc("B", 0.85),
          fakePlanMc("C", 0.95),
        ]}
      />,
    );
    expect(screen.getAllByTestId("gauge")).toHaveLength(4);
  });

  it("shows ±pts delta vs baseline on non-baseline gauges", () => {
    render(
      <MonteCarloComparisonSection
        plansMc={[fakePlanMc("Base", 0.9), fakePlanMc("B", 0.85)]}
      />,
    );
    expect(screen.getByText(/−5 pts/)).toBeInTheDocument();
  });
});
