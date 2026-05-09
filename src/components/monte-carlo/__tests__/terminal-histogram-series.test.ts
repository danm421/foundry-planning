import { describe, it, expect } from "vitest";
import { buildHistogramSeries } from "../lib/terminal-histogram-series";

describe("buildHistogramSeries", () => {
  it("snaps bin edges to nicely rounded numbers", () => {
    // Range ≈ 870K with 12 target bins → raw step ~73K → snaps to 100K
    const values = Array.from({ length: 100 }, (_, i) => 130_000 + i * 8_700);
    const { bins } = buildHistogramSeries(values);
    const step = bins[1].min - bins[0].min;
    expect(step).toBe(100_000);
    // start is floor(domainLow/step)*step, so it's a multiple of step
    expect(bins[0].min % step).toBe(0);
  });

  it("counts sum to N, including domain-clipped values", () => {
    const values = Array.from({ length: 500 }, (_, i) => i * 2);
    const { bins, belowDomainCount, aboveDomainCount } = buildHistogramSeries(values);
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(500);
    // Sanity: clipped counts should be ≤ ~2% on each side of a 500-value sample
    expect(belowDomainCount + aboveDomainCount).toBeLessThanOrEqual(20);
  });

  it("exposes p5 / p25 / p50 / p75 / p95 of the input values", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const { p5, p25, p50, p75, p95 } = buildHistogramSeries(values);
    expect(p5).toBeCloseTo(5, 0);
    expect(p25).toBeCloseTo(25, 0);
    expect(p50).toBeCloseTo(50, 0);
    expect(p75).toBeCloseTo(75, 0);
    expect(p95).toBeCloseTo(95, 0);
  });

  it("clips outliers to the inner 96% so a lone giant doesn't stretch the bins", () => {
    // 999 trials in [$1M, $5M], one outlier at $100M
    const values = Array.from({ length: 999 }, (_, i) => 1_000_000 + i * 4_000);
    values.push(100_000_000);
    const { bins, aboveDomainCount } = buildHistogramSeries(values);
    // Domain should reflect the bulk, not the outlier
    expect(bins[bins.length - 1].max).toBeLessThan(10_000_000);
    expect(aboveDomainCount).toBeGreaterThan(0);
    // All values still accounted for
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(values.length);
  });

  it("handles degenerate input (all same value) without NaN", () => {
    const { bins, p50 } = buildHistogramSeries([1000, 1000, 1000]);
    expect(bins.length).toBeGreaterThan(0);
    expect(p50).toBe(1000);
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(3);
  });

  it("handles empty input without throwing", () => {
    const { bins } = buildHistogramSeries([]);
    expect(bins).toEqual([]);
  });

  it("computes mean and stdDev for SD bands", () => {
    // Symmetric values around 100 → mean=100, σ=√(Σ(v-μ)²/n)
    const values = [60, 80, 100, 120, 140];
    const { sd } = buildHistogramSeries(values);
    expect(sd.mean).toBeCloseTo(100, 5);
    // Population SD: variance = (40²+20²+0+20²+40²)/5 = 800; σ ≈ 28.28
    expect(sd.stdDev).toBeCloseTo(28.2843, 3);
    expect(sd.minus1).toBeCloseTo(100 - 28.2843, 3);
    expect(sd.plus1).toBeCloseTo(100 + 28.2843, 3);
    expect(sd.minus2).toBeCloseTo(100 - 56.5685, 3);
    expect(sd.plus2).toBeCloseTo(100 + 56.5685, 3);
  });

  it("counts trials within ±1σ and ±2σ from the mean", () => {
    // 1000 values uniformly spaced 1..1000 → mean=500.5, σ≈288.67
    const values = Array.from({ length: 1000 }, (_, i) => i + 1);
    const { sd } = buildHistogramSeries(values);
    // For uniform 1..1000, ±1σ covers about 58% of the range
    expect(sd.countWithin1).toBeGreaterThan(500);
    expect(sd.countWithin1).toBeLessThan(700);
    // ±2σ should cover essentially all of the range for a uniform distribution
    expect(sd.countWithin2).toBe(1000);
  });
});
