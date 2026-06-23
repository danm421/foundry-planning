// src/components/portal/__tests__/investment-trend-chart.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mirror the NetWorthTrendChart mock setup exactly.
vi.mock("react-chartjs-2", () => ({
  Line: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="chart">{data.labels.length}</div>
  ),
}));
vi.mock("chart.js", () => ({
  Chart: { register: () => {} },
  CategoryScale: {}, LinearScale: {}, LineElement: {}, PointElement: {},
  Filler: {}, Tooltip: {}, Legend: {},
}));
vi.mock("@/lib/chart-colors", () => ({
  useThemeName: () => "dark",
  chartChrome: () => ({ tick: "#000", grid: "#111", legend: "#222", title: "#333",
    tooltipBg: "#444", tooltipTitle: "#555", tooltipBody: "#666" }),
  dataPalette: () => ({ blue: "#2c5fa8" }),
}));

import { InvestmentTrendChart } from "../investment-trend-chart";

function mkSeries() {
  const pts = [];
  for (let i = 1; i <= 60; i++) {
    const d = new Date(Date.UTC(2026, 4, 1));
    d.setUTCDate(d.getUTCDate() + i);
    pts.push({ date: d.toISOString().slice(0, 10), netWorth: 50000 + i * 100 });
  }
  return pts;
}

describe("InvestmentTrendChart", () => {
  it("renders nothing for an empty/too-short series", () => {
    const { container } = render(
      <InvestmentTrendChart series={[]} asOfDate="2026-06-23" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the chart and has no 'net worth' heading", () => {
    const series = mkSeries();
    const asOf = series[series.length - 1].date;
    render(<InvestmentTrendChart series={series} asOfDate={asOf} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.queryByText(/net worth/i)).toBeNull();
  });
});
