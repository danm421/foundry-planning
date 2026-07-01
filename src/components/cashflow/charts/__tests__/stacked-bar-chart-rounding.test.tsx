// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { makeYear } from "./fixtures";

// Capture the `data` prop Chart.js would receive instead of painting to canvas,
// so we can assert on the numbers that drive the bars. (In this file only — the
// sibling test exercises the real react-chartjs-2 render path.)
const captured: { data: { datasets: { data: number[] }[] } | null } = { data: null };
vi.mock("react-chartjs-2", () => ({
  Bar: (props: { data: { datasets: { data: number[] }[] } }) => {
    captured.data = props.data;
    return null;
  },
}));

// Import AFTER the mock is registered.
import { StackedBarChart } from "../stacked-bar-chart";

describe("StackedBarChart — whole-dollar rounding", () => {
  beforeEach(() => {
    captured.data = null;
  });

  it("rounds sub-dollar noise to whole dollars so effectively-zero years render as no bar", () => {
    // Sub-dollar floating-point tax residue: without rounding the y-axis would
    // auto-scale to a fraction of a dollar and amplify this into full-height
    // bars beneath an all-"$0" axis (the reported state-tax chart bug).
    const years = [
      makeYear({ year: 2026, totalIncome: 0.0001 }),
      makeYear({ year: 2027, totalIncome: 0.8 }),
      makeYear({ year: 2028, totalIncome: 152.4 }),
    ];

    render(
      <StackedBarChart
        years={years}
        series={[{ label: "State Income Tax", colorKey: "teal", valueFor: (y) => y.totalIncome }]}
        title="State income tax"
      />,
    );

    expect(captured.data).not.toBeNull();
    // 0.0001 → 0 (no bar), 0.8 → 1, 152.4 → 152.
    expect(captured.data!.datasets[0].data).toEqual([0, 1, 152]);
  });
});
