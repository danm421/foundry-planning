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
  it("returns six datasets in the order chart.js fill:'-1' expects when deterministic is provided", () => {
    const byYear = mkByYear(5);
    const deterministic = [350, 360, 370, 380, 390];
    const { datasets, ages } = buildFanChartSeries(byYear, deterministic);

    expect(ages).toEqual([60, 61, 62, 63, 64]);
    expect(datasets).toHaveLength(6);
    expect(datasets[0].label).toBe("p5-baseline");
    expect(datasets[1].label).toBe("5th–95th percentile");
    expect(datasets[2].label).toBe("p20-baseline");
    expect(datasets[3].label).toBe("20th–80th percentile");
    expect(datasets[4].label).toBe("Median");
    expect(datasets[5].label).toBe("Cash-flow projection");
  });

  it("wires fill:'-1' on band datasets so they stack off their baselines", () => {
    const { datasets } = buildFanChartSeries(mkByYear(3), [0, 0, 0]);
    expect(datasets[1].fill).toBe("-1"); // p95 fills down to p5 baseline
    expect(datasets[3].fill).toBe("-1"); // p80 fills down to p20 baseline
    expect(datasets[0].fill).toBe(false);
    expect(datasets[2].fill).toBe(false);
    expect(datasets[4].fill).toBe(false);
    expect(datasets[5].fill).toBe(false);
  });

  it("copies percentile values correctly into the right datasets", () => {
    const byYear = mkByYear(3);
    const { datasets } = buildFanChartSeries(byYear, [999, 999, 999]);
    expect(datasets[0].data).toEqual([100, 101, 102]); // p5
    expect(datasets[1].data).toEqual([500, 501, 502]); // p95
    expect(datasets[2].data).toEqual([200, 201, 202]); // p20
    expect(datasets[3].data).toEqual([400, 401, 402]); // p80
    expect(datasets[4].data).toEqual([300, 301, 302]); // p50
    expect(datasets[5].data).toEqual([999, 999, 999]); // deterministic
  });

  it("omits the deterministic overlay dataset when deterministic is undefined", () => {
    const { datasets } = buildFanChartSeries(mkByYear(3), undefined);
    expect(datasets).toHaveLength(5);
    expect(datasets.find((d) => d.label === "Cash-flow projection")).toBeUndefined();
  });
});
