// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IncomeExpenseComparisonSection } from "../income-expense-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

// Chart.js needs canvas APIs that jsdom lacks; stub <Bar> so we just see structure.
vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="chart" />,
}));

function mkPlan(label: string, years: number[]): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: years.map((year) => ({
        year,
        income: {
          salaries: 0,
          socialSecurity: 0,
          business: 0,
          trust: 0,
          deferred: 0,
          capitalGains: 0,
          other: 0,
          total: 0,
          bySource: {},
        },
        expenses: {
          living: 0,
          liabilities: 0,
          other: 0,
          insurance: 0,
          realEstate: 0,
          taxes: 0,
          cashGifts: 0,
          total: 0,
          bySource: {},
          byLiability: {},
          interestByLiability: {},
        },
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("IncomeExpenseComparisonSection", () => {
  it("renders one chart per plan (2 plans)", () => {
    render(
      <IncomeExpenseComparisonSection
        plans={[mkPlan("A", [2030, 2031]), mkPlan("B", [2030, 2031])]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(2);
  });

  it("renders 4 charts when given 4 plans", () => {
    render(
      <IncomeExpenseComparisonSection
        plans={[
          mkPlan("A", [2030]),
          mkPlan("B", [2030]),
          mkPlan("C", [2030]),
          mkPlan("D", [2030]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(4);
  });

  it("includes each plan label", () => {
    render(
      <IncomeExpenseComparisonSection
        plans={[mkPlan("Plan A", [2030]), mkPlan("Plan B", [2030])]}
        yearRange={null}
      />,
    );
    expect(screen.getByText("Plan A")).toBeTruthy();
    expect(screen.getByText("Plan B")).toBeTruthy();
  });
});
