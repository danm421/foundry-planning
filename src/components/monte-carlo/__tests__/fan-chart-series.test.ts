import { describe, it, expect } from "vitest";
import { buildFanChartSeries } from "../lib/fan-chart-series";
import type { MonteCarloSummary } from "@/engine";

function mkByYear(years: number): MonteCarloSummary["byYear"] {
  return Array.from({ length: years }, (_, i) => ({
    year: 2026 + i,
    age: { client: 60 + i },
    balance: {
      p5: 100 + i,
      p20: 200 + i,
      p50: 300 + i,
      p80: 400 + i,
      p95: 500 + i,
      min: 50 + i,
      max: 600 + i,
    },
    cagrFromStart: null,
  }));
}

describe("buildFanChartSeries", () => {
  it("returns four datasets in order when deterministic is provided", () => {
    const byYear = mkByYear(5);
    const deterministic = [350, 360, 370, 380, 390];
    const { datasets, ages } = buildFanChartSeries(byYear, deterministic);

    expect(ages).toEqual([60, 61, 62, 63, 64]);
    expect(datasets).toHaveLength(4);
    expect(datasets[0].label).toBe("Above average (80th)");
    expect(datasets[1].label).toBe("Median");
    expect(datasets[2].label).toBe("Below average (20th)");
    expect(datasets[3].label).toBe("Cash-flow projection");
  });

  it("copies p80 / p50 / p20 / deterministic values into the right datasets", () => {
    const byYear = mkByYear(3);
    const { datasets } = buildFanChartSeries(byYear, [999, 999, 999]);
    expect(datasets[0].data).toEqual([400, 401, 402]); // p80
    expect(datasets[1].data).toEqual([300, 301, 302]); // p50
    expect(datasets[2].data).toEqual([200, 201, 202]); // p20
    expect(datasets[3].data).toEqual([999, 999, 999]); // deterministic
  });

  it("omits the deterministic overlay when deterministic is undefined", () => {
    const { datasets } = buildFanChartSeries(mkByYear(3), undefined);
    expect(datasets).toHaveLength(3);
    expect(datasets.find((d) => d.label === "Cash-flow projection")).toBeUndefined();
  });

  it("passes through zero and negative values untouched (linear scale renders them fine)", () => {
    const byYear: MonteCarloSummary["byYear"] = [
      { year: 2026, age: { client: 60 }, balance: { p5: -500, p20: -100, p50: 0, p80: 100, p95: 200, min: -1000, max: 300 }, cagrFromStart: null },
    ];
    const { datasets } = buildFanChartSeries(byYear, [0]);
    expect(datasets[0].data).toEqual([100]);  // p80
    expect(datasets[1].data).toEqual([0]);    // p50
    expect(datasets[2].data).toEqual([-100]); // p20
    expect(datasets[3].data).toEqual([0]);    // deterministic
  });

  it("fills the three percentile datasets to origin and leaves the cash-flow line unfilled", () => {
    const { datasets } = buildFanChartSeries(mkByYear(3), [100, 200, 300]);
    expect(datasets[0].fill).toBe("origin");  // above average
    expect(datasets[1].fill).toBe("origin");  // median
    expect(datasets[2].fill).toBe("origin");  // below average
    expect(datasets[3].fill).toBe(false);     // cash-flow
  });
});
