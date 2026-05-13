// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiquidityComparisonCharts } from "../liquidity-comparison-charts";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("@/components/yearly-liquidity-chart", () => ({
  YearlyLiquidityChart: () => <div data-testid="liquidity-chart" />,
}));

function fakePlan(label: string): ComparisonPlan {
  return {
    index: 0,
    isBaseline: false,
    ref: { kind: "scenario", id: "x", toggleState: {} },
    id: "x",
    label,
    tree: {} as never,
    result: { years: [] } as never,
    lifetime: { total: 0, byBucket: {} as never },
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  } as unknown as ComparisonPlan;
}

describe("LiquidityComparisonCharts", () => {
  it("renders one chart per plan", () => {
    render(<LiquidityComparisonCharts plans={[fakePlan("a"), fakePlan("b"), fakePlan("c")]} />);
    expect(screen.getAllByTestId("liquidity-chart")).toHaveLength(3);
  });
});
