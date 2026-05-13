// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SsIncomeComparisonSection } from "../ss-income-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="chart" />,
}));

function mkPlan(label: string, ss: number[]): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label, toggleState: {} },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: ss.map((amount, i) => ({
        year: 2030 + i,
        income: { socialSecurity: amount } as ComparisonPlan["result"]["years"][number]["income"],
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("SsIncomeComparisonSection", () => {
  it("renders one chart and one stat row per plan", () => {
    render(
      <SsIncomeComparisonSection
        plans={[mkPlan("A", [10000, 20000]), mkPlan("B", [30000, 40000])]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(1);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("clips by yearRange in stat-row lifetime totals", () => {
    render(
      <SsIncomeComparisonSection
        plans={[mkPlan("A", [10000, 20000, 30000])]}
        yearRange={{ start: 2031, end: 2031 }}
      />,
    );
    // Lifetime total within range = 20000
    expect(screen.getByText(/\$20,000/)).toBeTruthy();
  });

  it("renders an empty state when no plan has SS income in range", () => {
    render(
      <SsIncomeComparisonSection
        plans={[mkPlan("A", [0, 0])]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/No Social Security income/i)).toBeTruthy();
  });
});
