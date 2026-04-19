import { describe, it, expect } from "vitest";
import { buildHistogramSeries } from "../lib/terminal-histogram-series";

describe("buildHistogramSeries", () => {
  it("produces 20 bins by default", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i);
    const series = buildHistogramSeries(values);
    expect(series.bins).toHaveLength(20);
  });

  it("covers min to max exactly", () => {
    const values = [100, 200, 300, 400, 500];
    const { bins } = buildHistogramSeries(values);
    expect(bins[0].min).toBeCloseTo(100, 5);
    expect(bins[bins.length - 1].max).toBeCloseTo(500, 5);
  });

  it("counts sum to N", () => {
    const values = Array.from({ length: 500 }, (_, i) => i * 2);
    const { bins } = buildHistogramSeries(values);
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(500);
  });

  it("exposes p5 / p50 / p95 of the input values", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const { p5, p50, p95 } = buildHistogramSeries(values);
    expect(p5).toBeCloseTo(5, 0);
    expect(p50).toBeCloseTo(50, 0);
    expect(p95).toBeCloseTo(95, 0);
  });

  it("handles degenerate input (all same value) without NaN", () => {
    const { bins, p50 } = buildHistogramSeries([1000, 1000, 1000]);
    expect(bins).toHaveLength(20);
    expect(p50).toBe(1000);
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(3);
  });

  it("handles empty input without throwing", () => {
    const { bins } = buildHistogramSeries([]);
    expect(bins).toEqual([]);
  });
});
