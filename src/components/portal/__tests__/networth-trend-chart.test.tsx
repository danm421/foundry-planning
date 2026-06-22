// src/components/portal/__tests__/networth-trend-chart.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock react-chartjs-2 so jsdom never has to draw a canvas; echo the point count.
vi.mock("react-chartjs-2", () => ({
  Line: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="chart">{data.labels.length}</div>
  ),
}));
// chart.js register() is a no-op in tests but the import must resolve.
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

import { NetWorthTrendChart } from "../networth-trend-chart";

function mkSeries() {
  const pts = [];
  for (let i = 1; i <= 400; i++) {
    const d = new Date(Date.UTC(2025, 5, 22));
    d.setUTCDate(d.getUTCDate() + i);
    pts.push({ date: d.toISOString().slice(0, 10), netWorth: 1000 + i });
  }
  return pts; // spans > 1 year ending ~2026-07
}

describe("NetWorthTrendChart", () => {
  it("renders nothing for an empty/too-short series", () => {
    const { container } = render(<NetWorthTrendChart series={[]} asOfDate="2026-06-22" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults to 1Y and narrows to 1W when that button is clicked", () => {
    const series = mkSeries();
    const asOf = series[series.length - 1].date;
    render(<NetWorthTrendChart series={series} asOfDate={asOf} />);
    const oneYearCount = Number(screen.getByTestId("chart").textContent);
    expect(oneYearCount).toBeGreaterThan(300); // ~365 points
    fireEvent.click(screen.getByRole("button", { name: "1W" }));
    const oneWeekCount = Number(screen.getByTestId("chart").textContent);
    expect(oneWeekCount).toBeLessThanOrEqual(8);
  });
});
