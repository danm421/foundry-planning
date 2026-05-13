// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IncomeSourcesComparisonSection } from "../income-sources-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(label: string, incomes: Array<unknown>): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: { incomes } as unknown as ComparisonPlan["tree"],
    result: { years: [] } as unknown as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("IncomeSourcesComparisonSection", () => {
  it("renders each income source with type and amount", () => {
    const plan = mkPlan("A", [
      {
        id: "i1",
        name: "Cooper's Salary",
        type: "salary",
        annualAmount: 200_000,
        startYear: 2025,
        endYear: 2040,
      },
      {
        id: "i2",
        name: "Cooper's Social Security",
        type: "social_security",
        annualAmount: 30_000,
        startYear: 2042,
        endYear: 2075,
      },
    ]);
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    expect(screen.getByText("Cooper's Salary")).toBeTruthy();
    expect(screen.getByText("Cooper's Social Security")).toBeTruthy();
    expect(screen.getByText(/\$200,000/)).toBeTruthy();
  });

  it("renders empty state when no incomes", () => {
    const plan = mkPlan("A", []);
    render(<IncomeSourcesComparisonSection plans={[plan]} />);
    expect(screen.getByText(/No income sources/i)).toBeTruthy();
  });
});
