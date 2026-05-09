// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PortfolioOverlayChart } from "../portfolio-overlay-chart";
import type { ProjectionYear } from "@/engine/types";

vi.mock("react-chartjs-2", () => ({
  Bar: ({ data }: { data: { labels: number[]; datasets: Array<{ label: string; data: number[] }> } }) => (
    <pre data-testid="chart">{JSON.stringify(data)}</pre>
  ),
}));

// Each "year" in this fixture spreads the total across the four liquid buckets
// the chart sums. The split doesn't matter — only the sum.
function years(totals: number[]): ProjectionYear[] {
  return totals.map((t, i) => ({
    year: 2025 + i,
    portfolioAssets: {
      taxableTotal: t,
      cashTotal: 0,
      retirementTotal: 0,
      lifeInsuranceTotal: 0,
    },
  } as unknown as ProjectionYear));
}

describe("PortfolioOverlayChart", () => {
  it("emits common-floor + plan2-ahead + plan1-ahead stacked bars", () => {
    const { getByTestId } = render(
      <PortfolioOverlayChart
        plan1Years={years([100, 200, 400])}
        plan2Years={years([150, 200, 300])}
        plan1Label="Base"
        plan2Label="Aggressive"
      />,
    );
    const data = JSON.parse(getByTestId("chart").textContent ?? "{}");
    expect(data.labels).toEqual([2025, 2026, 2027]);
    expect(data.datasets).toHaveLength(3);

    // Common floor = min(plan1, plan2) per year
    expect(data.datasets[0].label).toBe("Common floor (vs Base)");
    expect(data.datasets[0].data).toEqual([100, 200, 300]);

    // Plan 2 ahead of Plan 1 = max(0, plan2 - plan1)
    expect(data.datasets[1].label).toBe("Aggressive ahead of Base");
    expect(data.datasets[1].data).toEqual([50, 0, 0]);

    // Plan 1 ahead of Plan 2 = max(0, plan1 - plan2)
    expect(data.datasets[2].label).toBe("Base ahead of Aggressive");
    expect(data.datasets[2].data).toEqual([0, 0, 100]);
  });

  it("aligns plan 1 to plan 2 by year (not array index)", () => {
    // Plan 1 starts in 2025, plan 2 starts in 2026 — only 2026 should align.
    const plan1 = years([100, 200, 300]); // 2025/26/27
    const plan2: ProjectionYear[] = [
      { year: 2026, portfolioAssets: { taxableTotal: 250, cashTotal: 0, retirementTotal: 0, lifeInsuranceTotal: 0 } } as unknown as ProjectionYear,
      { year: 2027, portfolioAssets: { taxableTotal: 350, cashTotal: 0, retirementTotal: 0, lifeInsuranceTotal: 0 } } as unknown as ProjectionYear,
    ];
    const { getByTestId } = render(
      <PortfolioOverlayChart plan1Years={plan1} plan2Years={plan2} plan1Label="Base" plan2Label="Alt" />,
    );
    const data = JSON.parse(getByTestId("chart").textContent ?? "{}");
    expect(data.labels).toEqual([2026, 2027]);
    // Plan 2 ahead by 50 in 2026 (250 − 200), 50 in 2027 (350 − 300)
    expect(data.datasets[1].data).toEqual([50, 50]);
    expect(data.datasets[2].data).toEqual([0, 0]);
  });
});
