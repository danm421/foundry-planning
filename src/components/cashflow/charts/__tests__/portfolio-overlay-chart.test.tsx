// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PortfolioOverlayChart } from "../portfolio-overlay-chart";
import type { ProjectionYear } from "@/engine/types";

vi.mock("react-chartjs-2", () => ({
  Line: ({ data }: { data: { datasets: Array<{ label: string; data: number[] }> } }) => (
    <pre data-testid="chart">{JSON.stringify(data)}</pre>
  ),
}));

function years(totals: number[]): ProjectionYear[] {
  return totals.map((t, i) => ({
    year: 2025 + i,
    portfolioAssets: { total: t },
  } as unknown as ProjectionYear));
}

describe("PortfolioOverlayChart", () => {
  it("emits two datasets with the provided plan labels and totals", () => {
    const { getByTestId } = render(
      <PortfolioOverlayChart
        plan1Years={years([100, 200, 300])}
        plan2Years={years([100, 250, 400])}
        plan1Label="Base"
        plan2Label="Aggressive"
      />,
    );
    const data = JSON.parse(getByTestId("chart").textContent ?? "{}");
    expect(data.datasets).toHaveLength(2);
    expect(data.datasets[0].label).toBe("Base");
    expect(data.datasets[1].label).toBe("Aggressive");
    expect(data.datasets[0].data).toEqual([100, 200, 300]);
    expect(data.datasets[1].data).toEqual([100, 250, 400]);
    expect(data.labels).toEqual([2025, 2026, 2027]);
  });
});
