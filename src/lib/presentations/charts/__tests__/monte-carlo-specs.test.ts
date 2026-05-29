import { describe, it, expect } from "vitest";
import {
  buildFanChartSpec,
  buildHistogramChartSpec,
  buildSuccessChartSpec,
} from "../monte-carlo-specs";
import type { MonteCarloSummary } from "@/engine";
import type { HistogramSeries } from "@/lib/monte-carlo/histogram-series";

const summary: MonteCarloSummary = {
  requestedTrials: 1000,
  trialsRun: 1000,
  aborted: false,
  successRate: 0.84,
  failureRate: 0.16,
  ending: { p5: 100, p20: 300, p50: 600, p80: 900, p95: 1200, min: 0, max: 1500, mean: 620 },
  byYear: [
    { year: 2026, age: { client: 65 }, balance: { p5: 90, p20: 280, p50: 560, p80: 840, p95: 1100, min: 0, max: 1200 }, cagrFromStart: { p5: -0.02, p20: 0.01, p50: 0.05, p80: 0.08, p95: 0.11 } },
    { year: 2027, age: { client: 66 }, balance: { p5: 80, p20: 260, p50: 540, p80: 820, p95: 1080, min: 0, max: 1180 }, cagrFromStart: { p5: -0.03, p20: 0.00, p50: 0.045, p80: 0.078, p95: 0.10 } },
  ],
};

const histogram: HistogramSeries = {
  bins: [
    { min: 0, max: 500, count: 200 },
    { min: 500, max: 1000, count: 600 },
    { min: 1000, max: 1500, count: 200 },
  ],
  p5: 100, p25: 400, p50: 600, p75: 850, p95: 1200,
  belowDomainCount: 0, aboveDomainCount: 0,
  sd: { mean: 620, stdDev: 250, minus2: 120, minus1: 370, plus1: 870, plus2: 1120, countWithin1: 700, countWithin2: 950, countBelowMinus2: 10, countAbovePlus2: 40 },
};

describe("buildFanChartSpec", () => {
  it("emits median + band from byYear percentiles and a deterministic line", () => {
    const spec = buildFanChartSpec({
      byYear: summary.byYear,
      deterministic: [555, 545],
      markers: [{ atYear: 2026, label: "Retire 65" }],
    });
    expect(spec.years).toEqual([2026, 2027]);
    expect(spec.median).toEqual([560, 540]);
    expect(spec.band.upper).toEqual([840, 820]); // p80
    expect(spec.band.lower).toEqual([280, 260]); // p20
    expect(spec.deterministic).toEqual([555, 545]);
    expect(spec.yDomain[0]).toBe(0);
    expect(spec.yDomain[1]).toBeGreaterThanOrEqual(840);
    expect(spec.markers).toHaveLength(1);
  });

  it("tolerates a missing deterministic line", () => {
    const spec = buildFanChartSpec({ byYear: summary.byYear, deterministic: null, markers: [] });
    expect(spec.deterministic).toBeNull();
  });
});

describe("buildHistogramChartSpec", () => {
  it("maps bins and the five percentile markers", () => {
    const spec = buildHistogramChartSpec(histogram);
    expect(spec.bins).toHaveLength(3);
    const labels = spec.percentileMarkers.map((m) => m.label);
    expect(labels).toEqual(["P5", "P25", "P50", "P75", "P95"]);
    expect(spec.percentileMarkers.find((m) => m.label === "P50")?.emphasis).toBe(true);
    expect(spec.yDomain[1]).toBeGreaterThanOrEqual(600);
  });
});

describe("buildSuccessChartSpec", () => {
  it("color-codes bars by the success thresholds", () => {
    const spec = buildSuccessChartSpec({
      successRates: [0.95, 0.8, 0.6, 0.2],
      years: [2026, 2027, 2028, 2029],
      ages: [65, 66, 67, 68],
    });
    expect(spec.bars.map((b) => b.value)).toEqual([0.95, 0.8, 0.6, 0.2]);
    // distinct color per threshold band
    expect(new Set(spec.bars.map((b) => b.color)).size).toBe(4);
    // labels prefer age when present
    expect(spec.bars[0].label).toBe("65");
  });
});
