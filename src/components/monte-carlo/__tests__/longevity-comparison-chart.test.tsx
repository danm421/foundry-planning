// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LongevityComparisonChart } from "../longevity-comparison-chart";

vi.mock("react-chartjs-2", () => ({
  Line: ({ data }: { data: { datasets: Array<{ label: string; data: number[] }> } }) => (
    <pre data-testid="chart">{JSON.stringify(data)}</pre>
  ),
}));

describe("LongevityComparisonChart", () => {
  it("emits two datasets of per-year success rates", () => {
    const matrix1 = [[200, 150, 50], [200, 80, 40], [200, 200, 200]]; // success 1, 2/3, 1/3
    const matrix2 = [[200, 200, 200], [200, 200, 100], [200, 200, 100]]; // success 1, 1, 1/3
    const { getByTestId } = render(
      <LongevityComparisonChart
        plan1Matrix={matrix1}
        plan2Matrix={matrix2}
        threshold={100}
        planStartYear={2025}
        plan1Label="Base"
        plan2Label="Aggressive"
      />,
    );
    const data = JSON.parse(getByTestId("chart").textContent ?? "{}");
    expect(data.labels).toEqual([2025, 2026, 2027]);
    expect(data.datasets[0].label).toBe("Base");
    // floating-point: (2/3)*100 vs 200/3 differ by 1 ULP — use closeTo
    expect(data.datasets[0].data[0]).toBeCloseTo(100, 10);
    expect(data.datasets[0].data[1]).toBeCloseTo((200 / 3), 10);
    expect(data.datasets[0].data[2]).toBeCloseTo((100 / 3), 10);
    expect(data.datasets[1].label).toBe("Aggressive");
    expect(data.datasets[1].data[0]).toBeCloseTo(100, 10);
    expect(data.datasets[1].data[1]).toBeCloseTo(100, 10);
    expect(data.datasets[1].data[2]).toBeCloseTo((100 / 3), 10);
  });
});
