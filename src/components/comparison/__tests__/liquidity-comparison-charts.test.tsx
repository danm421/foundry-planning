// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LiquidityComparisonCharts } from "../liquidity-comparison-charts";
import type { YearlyLiquidityRow } from "@/lib/estate/yearly-liquidity-report";

vi.mock("react-chartjs-2", () => ({
  Chart: ({ data }: { data: { labels: string[] } }) => (
    <pre data-testid="chart">{JSON.stringify(data.labels)}</pre>
  ),
}));

const row = (year: number): YearlyLiquidityRow => ({
  year,
  ageClient: null,
  ageSpouse: null,
  insuranceInEstate: 100,
  insuranceOutOfEstate: 0,
  totalInsuranceBenefit: 100,
  totalPortfolioAssets: 1000,
  totalTransferCost: 50,
  surplusDeficitWithPortfolio: 1050,
  surplusDeficitInsuranceOnly: 50,
});

describe("LiquidityComparisonCharts", () => {
  it("renders both plan labels and two charts", () => {
    const { getByText, getAllByTestId } = render(
      <LiquidityComparisonCharts
        plan1Label="Base"
        plan2Label="Proposed"
        plan1Rows={[row(2025), row(2026)]}
        plan2Rows={[row(2025), row(2026)]}
      />,
    );
    expect(getByText("Estate Liquidity")).toBeTruthy();
    expect(getByText("Base")).toBeTruthy();
    expect(getByText("Proposed")).toBeTruthy();
    expect(getAllByTestId("chart")).toHaveLength(2);
  });
});
