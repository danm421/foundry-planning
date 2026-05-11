// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DecadeSummaryComparisonSection } from "../decade-summary-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(label: string, samples: Array<{ year: number; totalIncome: number; totalExpenses: number; netCashFlow: number; totalTax: number; charitableOutflows: number }>): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: samples.map((s) => ({
        year: s.year,
        totalIncome: s.totalIncome,
        totalExpenses: s.totalExpenses,
        netCashFlow: s.netCashFlow,
        charitableOutflows: s.charitableOutflows,
        taxResult: { flow: { totalTax: s.totalTax } } as ComparisonPlan["result"]["years"][number]["taxResult"],
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("DecadeSummaryComparisonSection", () => {
  it("renders one row per decade bucket", () => {
    render(
      <DecadeSummaryComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 50, netCashFlow: 50, totalTax: 10, charitableOutflows: 5 },
            { year: 2031, totalIncome: 100, totalExpenses: 50, netCashFlow: 50, totalTax: 10, charitableOutflows: 5 },
            { year: 2042, totalIncome: 200, totalExpenses: 100, netCashFlow: 100, totalTax: 20, charitableOutflows: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByText("2030s")).toBeTruthy();
    expect(screen.getByText("2040s")).toBeTruthy();
  });

  it("renders an empty state when no years are in range", () => {
    render(
      <DecadeSummaryComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 50, netCashFlow: 50, totalTax: 10, charitableOutflows: 0 },
          ]),
        ]}
        yearRange={{ start: 2050, end: 2060 }}
      />,
    );
    expect(screen.getByText(/No projection years/i)).toBeTruthy();
  });

  it("sums values into the correct decade bucket", () => {
    render(
      <DecadeSummaryComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 0, netCashFlow: 100, totalTax: 0, charitableOutflows: 0 },
            { year: 2031, totalIncome: 200, totalExpenses: 0, netCashFlow: 200, totalTax: 0, charitableOutflows: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    // Verify the 2030s row contains the sum 300 for income (rendered as $300).
    // Both Income and Net Cash columns sum to $300 with this fixture, so use getAllByText.
    const row = screen.getByText("2030s").closest("tr")!;
    expect(within(row).getAllByText("$300").length).toBeGreaterThan(0);
  });
});
