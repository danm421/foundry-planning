export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

export interface HistogramSeries {
  bins: HistogramBin[];
  p5: number;
  p50: number;
  p95: number;
}

const BIN_COUNT = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

export function buildHistogramSeries(values: number[]): HistogramSeries {
  if (values.length === 0) {
    return { bins: [], p5: NaN, p50: NaN, p95: NaN };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;

  // Degenerate case — all identical values collapse into a single spike.
  // Fabricate 20 zero-width bins centered on the value so the chart still
  // has something to render; put the full count in the middle bin.
  if (range === 0) {
    const bins: HistogramBin[] = Array.from({ length: BIN_COUNT }, () => ({
      min,
      max,
      count: 0,
    }));
    bins[Math.floor(BIN_COUNT / 2)].count = values.length;
    return { bins, p5: min, p50: min, p95: min };
  }

  const binWidth = range / BIN_COUNT;
  const bins: HistogramBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    min: min + i * binWidth,
    max: min + (i + 1) * binWidth,
    count: 0,
  }));

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= BIN_COUNT) idx = BIN_COUNT - 1; // clamp the max value into the last bin
    bins[idx].count += 1;
  }

  return {
    bins,
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
  };
}
