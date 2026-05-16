// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MajorTransactionsComparisonSection } from "../major-transactions-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(label: string, years: ComparisonPlan["result"]["years"]): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: { years } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("MajorTransactionsComparisonSection", () => {
  it("renders one card per transaction year, with net surplus", () => {
    const plan = mkPlan("A", [
      {
        year: 2040,
        techniqueBreakdown: {
          sales: [{ transactionId: "s1", name: "Home", saleValue: 900_000, capitalGain: 0, netProceeds: 750_000, transactionCosts: 0, mortgagePaidOff: 0 }],
          purchases: [{ transactionId: "p1", name: "Townhouse", purchasePrice: 450_000, mortgageAmount: 0, equity: 450_000 }],
        },
      },
    ] as unknown as ComparisonPlan["result"]["years"]);
    render(<MajorTransactionsComparisonSection plans={[plan]} yearRange={null} />);
    expect(screen.getByText(/Transaction.*2040/i)).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Townhouse")).toBeTruthy();
    // 750_000 - 450_000 = 300_000
    expect(screen.getByText(/\$300,000/)).toBeTruthy();
  });

  it("clips by yearRange", () => {
    const plan = mkPlan("A", [
      { year: 2030, techniqueBreakdown: { sales: [{ transactionId: "s", name: "X", saleValue: 1, capitalGain: 0, netProceeds: 1, transactionCosts: 0, mortgagePaidOff: 0 }], purchases: [] } },
      { year: 2050, techniqueBreakdown: { sales: [{ transactionId: "s", name: "Y", saleValue: 2, capitalGain: 0, netProceeds: 2, transactionCosts: 0, mortgagePaidOff: 0 }], purchases: [] } },
    ] as unknown as ComparisonPlan["result"]["years"]);
    render(<MajorTransactionsComparisonSection plans={[plan]} yearRange={{ start: 2040, end: 2060 }} />);
    expect(screen.queryByText("X")).toBeNull();
    expect(screen.getByText("Y")).toBeTruthy();
  });

  it("renders empty state when no transactions in range", () => {
    const plan = mkPlan("A", [{ year: 2030 }] as unknown as ComparisonPlan["result"]["years"]);
    render(<MajorTransactionsComparisonSection plans={[plan]} yearRange={null} />);
    expect(screen.getByText(/No major transactions/i)).toBeTruthy();
  });
});
