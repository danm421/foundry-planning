// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashFlowGapComparisonSection } from "../cash-flow-gap-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="spark" />,
}));

function mkPlan(label: string, nets: Array<{ year: number; netCashFlow: number }>): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: nets.map((n) => ({
        year: n.year,
        netCashFlow: n.netCashFlow,
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("CashFlowGapComparisonSection", () => {
  it("shows gap count and listed years when there are gaps", () => {
    render(
      <CashFlowGapComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, netCashFlow: 1000 },
            { year: 2034, netCashFlow: -500 },
            { year: 2038, netCashFlow: -300 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/2 gap year/i)).toBeTruthy();
    expect(screen.getByText(/2034/)).toBeTruthy();
    expect(screen.getByText(/2038/)).toBeTruthy();
  });

  it("shows the no-gaps state with green check copy", () => {
    render(
      <CashFlowGapComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, netCashFlow: 100 },
            { year: 2031, netCashFlow: 200 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/No gap years/i)).toBeTruthy();
  });

  it("renders one sparkline per plan", () => {
    render(
      <CashFlowGapComparisonSection
        plans={[
          mkPlan("A", [{ year: 2030, netCashFlow: 100 }]),
          mkPlan("B", [{ year: 2030, netCashFlow: -100 }]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("spark")).toHaveLength(2);
  });
});
