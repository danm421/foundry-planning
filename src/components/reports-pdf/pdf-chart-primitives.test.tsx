// src/components/reports-pdf/pdf-chart-primitives.test.tsx
//
// Snapshot coverage of the SVG chart primitives. We don't rasterize the PDF
// — that's an integration concern. We just snapshot the React element tree
// each primitive returns so that future shape/attribute changes are
// reviewable in PR diffs.

import { describe, it, expect } from "vitest";
import {
  AreaSeries,
  AxisX,
  AxisY,
  BarSeries,
  DonutSeries,
  GridLines,
  Legend,
  LineSeries,
  StackedBarSeries,
  ValueLabel,
  fmtCompactDollar,
  fmtPercent,
  fmtPercentDecimal,
  fmtYearTick,
  niceYTicks,
  niceYearTicks,
  makePlot,
} from "./pdf-chart-primitives";

describe("formatters", () => {
  it("compact-dollar handles millions, thousands, smaller values, and negatives", () => {
    expect(fmtCompactDollar(1_200_000)).toBe("$1.2M");
    expect(fmtCompactDollar(12_000_000)).toBe("$12M");
    expect(fmtCompactDollar(340_000)).toBe("$340K");
    expect(fmtCompactDollar(50)).toBe("$50");
    expect(fmtCompactDollar(-50_000)).toBe("($50K)");
    expect(fmtCompactDollar(0)).toBe("$0");
    expect(fmtCompactDollar(NaN)).toBe("—");
  });

  it("percent / percent-decimal split 0-100 vs 0-1", () => {
    expect(fmtPercent(75)).toBe("75%");
    expect(fmtPercent(75.4)).toBe("75%");
    expect(fmtPercentDecimal(0.755)).toBe("75.5%");
    expect(fmtPercent(NaN)).toBe("—");
  });

  it("year tick is bare string", () => {
    expect(fmtYearTick(2030)).toBe("2030");
  });
});

describe("ticks", () => {
  it("niceYTicks returns evenly-spaced count ticks", () => {
    expect(niceYTicks([0, 100], 5)).toEqual([0, 25, 50, 75, 100]);
  });

  it("niceYearTicks picks 5-year cadence over 20-year span and includes endpoints", () => {
    const years = Array.from({ length: 26 }, (_, i) => 2025 + i);
    const ticks = niceYearTicks(years);
    // Should start at first year, end at last, with 5-year cadence in middle.
    expect(ticks[0]).toBe(2025);
    expect(ticks[ticks.length - 1]).toBe(2050);
    expect(ticks).toContain(2030);
    expect(ticks).toContain(2035);
  });

  it("niceYearTicks for short spans uses every-year cadence", () => {
    expect(niceYearTicks([2025, 2026, 2027, 2028, 2029])).toEqual([
      2025, 2026, 2027, 2028, 2029,
    ]);
  });
});

describe("makePlot", () => {
  it("scales linearly from data domain to inner pixel rectangle", () => {
    const plot = makePlot({
      width: 100,
      height: 100,
      xDomain: [0, 10],
      yDomain: [0, 100],
    });
    // Inner pad defaults: top 12, right 12, bottom 22, left 44.
    expect(plot.inner.x).toBe(44);
    expect(plot.inner.width).toBe(100 - 44 - 12);
    expect(plot.xScale(0)).toBe(plot.inner.x);
    expect(plot.xScale(10)).toBe(plot.inner.x + plot.inner.width);
    // Y is flipped so high values map to small SVG y.
    expect(plot.yScale(0)).toBe(plot.inner.y + plot.inner.height);
    expect(plot.yScale(100)).toBe(plot.inner.y);
  });
});

describe("primitives — element snapshots", () => {
  const plot = makePlot({
    width: 480,
    height: 220,
    xDomain: [2025, 2030],
    yDomain: [0, 100_000],
  });

  it("GridLines", () => {
    const el = GridLines({ plot });
    expect(el).toMatchSnapshot();
  });

  it("AxisX", () => {
    const el = AxisX({ plot, years: [2025, 2026, 2027, 2028, 2029, 2030] });
    expect(el).toMatchSnapshot();
  });

  it("AxisY", () => {
    const el = AxisY({ plot });
    expect(el).toMatchSnapshot();
  });

  it("BarSeries", () => {
    const el = BarSeries({
      plot,
      points: [
        { x: 2025, value: 50_000 },
        { x: 2026, value: 70_000 },
        { x: 2027, value: 30_000 },
      ],
      color: "#b87f1f",
      showLabels: true,
    });
    expect(el).toMatchSnapshot();
  });

  it("StackedBarSeries with positive + negative directions", () => {
    const el = StackedBarSeries({
      plot,
      xs: [2025, 2026],
      datasets: [
        { label: "Wages", color: "#b87f1f", values: [50_000, 60_000] },
        { label: "SS", color: "#2f6b4a", values: [10_000, 12_000] },
        {
          label: "Expenses",
          color: "#a13a3a",
          values: [40_000, 45_000],
          direction: "negative",
        },
      ],
    });
    expect(el).toMatchSnapshot();
  });

  it("LineSeries with dasharray", () => {
    const el = LineSeries({
      plot,
      points: [
        { x: 2025, value: 0 },
        { x: 2026, value: 25_000 },
        { x: 2027, value: 60_000 },
      ],
      strokeDasharray: "3 2",
    });
    expect(el).toMatchSnapshot();
  });

  it("AreaSeries with explicit lower band", () => {
    const el = AreaSeries({
      plot,
      points: [
        { x: 2025, value: 80_000 },
        { x: 2026, value: 90_000 },
      ],
      lowerPoints: [
        { x: 2025, value: 30_000 },
        { x: 2026, value: 40_000 },
      ],
    });
    expect(el).toMatchSnapshot();
  });

  it("DonutSeries with center label", () => {
    const el = DonutSeries({
      slices: [
        { label: "Cash", value: 100, color: "#b87f1f" },
        { label: "Taxable", value: 200, color: "#2f6b4a" },
      ],
      cx: 100,
      cy: 100,
      outerRadius: 60,
      innerRadius: 36,
      centerLabel: "$300",
      centerSubLabel: "Total",
    });
    expect(el).toMatchSnapshot();
  });

  it("DonutSeries with empty slices renders a hairline ring", () => {
    const el = DonutSeries({
      slices: [],
      cx: 100,
      cy: 100,
      outerRadius: 60,
      innerRadius: 36,
    });
    expect(el).toMatchSnapshot();
  });

  it("Legend (horizontal)", () => {
    const el = Legend({
      items: [
        { label: "Wages", color: "#b87f1f" },
        { label: "Social Security", color: "#2f6b4a" },
      ],
      x: 0,
      y: 200,
    });
    expect(el).toMatchSnapshot();
  });

  it("Legend (vertical)", () => {
    const el = Legend({
      items: [
        { label: "Cash", color: "#b87f1f" },
        { label: "Taxable", color: "#2f6b4a" },
      ],
      x: 0,
      y: 0,
      orientation: "vertical",
    });
    expect(el).toMatchSnapshot();
  });

  it("ValueLabel", () => {
    const el = ValueLabel({ x: 100, y: 50, text: "$1.2M" });
    expect(el).toMatchSnapshot();
  });
});
