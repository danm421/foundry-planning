// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WithdrawalSourceComparisonSection } from "../withdrawal-source-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="chart" />,
}));

function mkPlan(label: string): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {
      accounts: [
        {
          id: "trad",
          name: "Trad IRA",
          category: "retirement",
          subType: "traditional_ira",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
        },
        {
          id: "rot",
          name: "Roth IRA",
          category: "retirement",
          subType: "roth_ira",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
        },
        {
          id: "brk",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
        },
      ],
    } as ComparisonPlan["tree"],
    result: {
      years: [
        {
          year: 2040,
          income: {
            salaries: 0,
            socialSecurity: 30000,
            business: 0,
            trust: 0,
            deferred: 0,
            capitalGains: 0,
            other: 0,
            total: 30000,
            bySource: {},
          },
          withdrawals: { byAccount: { trad: 20000, rot: 5000, brk: 10000 }, total: 35000 },
        },
      ] as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("WithdrawalSourceComparisonSection", () => {
  it("renders one chart per plan", () => {
    render(
      <WithdrawalSourceComparisonSection
        plans={[mkPlan("A"), mkPlan("B")]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(2);
  });

  it("includes each plan label", () => {
    render(
      <WithdrawalSourceComparisonSection
        plans={[mkPlan("Plan A"), mkPlan("Plan B")]}
        yearRange={null}
      />,
    );
    expect(screen.getByText("Plan A")).toBeTruthy();
    expect(screen.getByText("Plan B")).toBeTruthy();
  });
});
