// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mirror the NetWorthTrendChart / InvestmentTrendChart mock setup: stub
// react-chartjs-2 so jsdom never draws a canvas, and echo back exactly what
// the component handed Chart.js.
vi.mock("react-chartjs-2", () => ({
  Line: ({
    data,
  }: {
    data: { labels: string[]; datasets: Array<{ label: string; data: unknown[]; borderColor: string }> };
  }) => (
    <>
      <div data-testid="labels-length">{data.labels.length}</div>
      <div data-testid="datasets">{JSON.stringify(data.datasets)}</div>
    </>
  ),
}));
vi.mock("chart.js", () => ({
  Chart: { register: () => {} },
  CategoryScale: {},
  LinearScale: {},
  LineElement: {},
  PointElement: {},
  Tooltip: {},
  Legend: {},
}));
// Real grey/blue hex from src/brand/index.ts's dark-theme `data` palette, and
// the real dark-theme `accent` hex — grounding the test's oracle in the
// actual design-system values rather than arbitrary strings.
const REAL_GREY = "#9ca3af";
const REAL_BLUE = "#2c5fa8";
const REAL_ACCENT = "#1f9e8c";
vi.mock("@/lib/chart-colors", () => ({
  useThemeName: () => "dark",
  chartChrome: () => ({
    tick: "#000",
    grid: "#111",
    legend: "#222",
    title: "#333",
    tooltipBg: "#444",
    tooltipTitle: "#555",
    tooltipBody: "#666",
  }),
  dataPalette: () => ({ grey: "#9ca3af", blue: "#2c5fa8" }),
}));

import { DebtPaydownChart } from "@/components/portal/debt-paydown-chart";
import type { PaydownComparison, PaydownRun } from "@/lib/calculators/debt-paydown";

function mkRun(balanceSeries: number[]): PaydownRun {
  return {
    monthsToDebtFree: balanceSeries.length - 1,
    totalInterest: 0,
    balanceSeries,
    perDebt: [],
    yearly: [],
    neverPaysOff: false,
    stalledDebtIds: [],
  };
}

function mkComparison(baselineSeries: number[], planSeries: number[]): PaydownComparison {
  return {
    baseline: mkRun(baselineSeries),
    plan: mkRun(planSeries),
    interestSaved: 0,
    monthsSaved: 0,
    debtFreeMonth: null,
  };
}

// Baseline runs 6 months (never rolls, so it drags on); the plan pays the
// debt off at month 3 (index 3, zero balance) and its series simply stops
// there — this is the shape "the plan pays it off early" actually takes.
const BASELINE_SERIES = [10_000, 9_000, 8_000, 7_000, 6_000, 5_000];
const PLAN_SERIES = [10_000, 6_000, 2_000, 0];

describe("DebtPaydownChart", () => {
  it("pads the shorter (plan) series so both datasets are the same length as the labels", () => {
    const comparison = mkComparison(BASELINE_SERIES, PLAN_SERIES);
    render(<DebtPaydownChart comparison={comparison} startYear={2026} startMonth={1} />);

    const labelsLength = Number(screen.getByTestId("labels-length").textContent);
    const datasets = JSON.parse(screen.getByTestId("datasets").textContent ?? "[]");

    expect(labelsLength).toBe(BASELINE_SERIES.length); // 6 — the longer series
    expect(datasets).toHaveLength(2);
    expect(datasets[0].data).toHaveLength(labelsLength);
    expect(datasets[1].data).toHaveLength(labelsLength);
  });

  it("pads the plan's tail with 0, not null, so the line flattens instead of breaking", () => {
    const comparison = mkComparison(BASELINE_SERIES, PLAN_SERIES);
    render(<DebtPaydownChart comparison={comparison} startYear={2026} startMonth={1} />);

    const datasets = JSON.parse(screen.getByTestId("datasets").textContent ?? "[]");
    const planData: Array<number | null> = datasets[1].data;

    // PLAN_SERIES has 4 real entries (indices 0-3); indices 4 and 5 exist
    // only because of padding to match the 6-long baseline/labels array.
    expect(planData).toHaveLength(6);
    expect(planData[4]).toBe(0);
    expect(planData[5]).toBe(0);
    expect(planData[4]).not.toBeNull();
    expect(planData[5]).not.toBeNull();
  });

  it("renders nothing when the longer series has fewer than 2 points", () => {
    // Both series are already at the paid-off starting balance — a single
    // "today" point, same shape simulatePaydown returns when nothing to run.
    const comparison = mkComparison([0], [0]);
    const { container } = render(
      <DebtPaydownChart comparison={comparison} startYear={2026} startMonth={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("never colors a data series with the reserved accent hue", () => {
    const comparison = mkComparison(BASELINE_SERIES, PLAN_SERIES);
    render(<DebtPaydownChart comparison={comparison} startYear={2026} startMonth={1} />);

    const datasets = JSON.parse(screen.getByTestId("datasets").textContent ?? "[]");
    const baselineColor = datasets[0].borderColor;
    const planColor = datasets[1].borderColor;

    // Sourced from dataPalette (the mocked grey/blue) ...
    expect(baselineColor).toBe(REAL_GREY);
    expect(planColor).toBe(REAL_BLUE);
    // ... and neither is the accent-verdigris hue, which the design system
    // reserves for action and never for a data value.
    expect(baselineColor).not.toBe(REAL_ACCENT);
    expect(planColor).not.toBe(REAL_ACCENT);
  });
});
