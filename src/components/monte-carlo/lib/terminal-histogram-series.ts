export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

/**
 * Standard-deviation bands around the mean. The MC ending-value distribution
 * is typically right-skewed (lognormal-ish), but linear σ bands are still a
 * reasonable communication aid: ~68% of trials fall within ±1σ, ~95% within
 * ±2σ for a normal distribution. The actual trial counts (countWithin1,
 * countWithin2) are computed from the data so the user sees the truth.
 */
export interface SDBands {
  mean: number;
  stdDev: number;
  /** Boundary value: mean − 2σ. May be < 0 for skewed distributions. */
  minus2: number;
  /** Boundary value: mean − σ. */
  minus1: number;
  /** Boundary value: mean + σ. */
  plus1: number;
  /** Boundary value: mean + 2σ. */
  plus2: number;
  /** Trials within ±1σ of the mean. */
  countWithin1: number;
  /** Trials within ±2σ of the mean. */
  countWithin2: number;
  /** Trials below mean − 2σ. */
  countBelowMinus2: number;
  /** Trials above mean + 2σ. */
  countAbovePlus2: number;
}

export interface HistogramSeries {
  bins: HistogramBin[];
  p5: number;
  p50: number;
  p95: number;
  /** Trials whose value fell below the displayed domain (folded into bin 0). */
  belowDomainCount: number;
  /** Trials whose value fell above the displayed domain (folded into the last bin). */
  aboveDomainCount: number;
  sd: SDBands;
}

const TARGET_BIN_COUNT = 12;
// Clip the histogram domain to the inner 96% of trials. Without this, a single
// outlier (e.g. one trial ending at $50M while most cluster around $5M)
// stretches the range so much that the visible bars carry no information. The
// clipped trials don't disappear — they fold into the first/last bin.
const CLIP_LOW_PERCENTILE = 0.02;
const CLIP_HIGH_PERCENTILE = 0.98;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function computeSDBands(values: number[]): SDBands {
  const n = values.length;
  if (n === 0) {
    return {
      mean: NaN, stdDev: NaN,
      minus2: NaN, minus1: NaN, plus1: NaN, plus2: NaN,
      countWithin1: 0, countWithin2: 0, countBelowMinus2: 0, countAbovePlus2: 0,
    };
  }
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let ssq = 0;
  for (const v of values) ssq += (v - mean) ** 2;
  const stdDev = Math.sqrt(ssq / n);

  const minus2 = mean - 2 * stdDev;
  const minus1 = mean - stdDev;
  const plus1 = mean + stdDev;
  const plus2 = mean + 2 * stdDev;

  let countWithin1 = 0, countWithin2 = 0, countBelowMinus2 = 0, countAbovePlus2 = 0;
  for (const v of values) {
    if (v >= minus1 && v <= plus1) countWithin1++;
    if (v >= minus2 && v <= plus2) countWithin2++;
    if (v < minus2) countBelowMinus2++;
    if (v > plus2) countAbovePlus2++;
  }

  return { mean, stdDev, minus2, minus1, plus1, plus2, countWithin1, countWithin2, countBelowMinus2, countAbovePlus2 };
}

/**
 * Snap a raw bin-width to a "nice" round number — one of 1, 2, 2.5, 5, or 10
 * times a power of ten. This is the same trick d3.scale uses for axis ticks.
 * It guarantees the histogram bin edges land on values like $500K / $1M / $2.5M
 * instead of $487,213.92.
 */
function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const mag = Math.pow(10, exp);
  const m = rawStep / mag;
  let nice: number;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 2.5) nice = 2.5;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}

export function buildHistogramSeries(values: number[]): HistogramSeries {
  if (values.length === 0) {
    return {
      bins: [], p5: NaN, p50: NaN, p95: NaN,
      belowDomainCount: 0, aboveDomainCount: 0,
      sd: computeSDBands([]),
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const trueMin = sorted[0];
  const trueMax = sorted[sorted.length - 1];

  const p5 = percentile(sorted, 0.05);
  const p50 = percentile(sorted, 0.50);
  const p95 = percentile(sorted, 0.95);
  const sd = computeSDBands(values);

  // Degenerate case — all identical values collapse into a single spike.
  // Fabricate TARGET_BIN_COUNT zero-width bins centered on the value so the
  // chart still has something to render.
  if (trueMin === trueMax) {
    const bins: HistogramBin[] = Array.from({ length: TARGET_BIN_COUNT }, () => ({
      min: trueMin,
      max: trueMax,
      count: 0,
    }));
    bins[Math.floor(TARGET_BIN_COUNT / 2)].count = values.length;
    return { bins, p5: trueMin, p50: trueMin, p95: trueMin, belowDomainCount: 0, aboveDomainCount: 0, sd };
  }

  const domainLow = percentile(sorted, CLIP_LOW_PERCENTILE);
  const domainHigh = percentile(sorted, CLIP_HIGH_PERCENTILE);
  const clippedRange = domainHigh - domainLow;

  // If clipping collapses the range (e.g. >98% of trials are identical), fall
  // back to the true range so we still show a useful histogram.
  const usableLow = clippedRange > 0 ? domainLow : trueMin;
  const usableHigh = clippedRange > 0 ? domainHigh : trueMax;

  const rawStep = (usableHigh - usableLow) / TARGET_BIN_COUNT;
  const step = niceStep(rawStep);

  // Snap domain to bin-width-aligned boundaries. floor(low/step)*step is the
  // largest multiple of step ≤ low; ceil(high/step)*step is the smallest ≥ high.
  const start = Math.floor(usableLow / step) * step;
  const end = Math.ceil(usableHigh / step) * step;
  const binCount = Math.max(1, Math.round((end - start) / step));

  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    min: start + i * step,
    max: start + (i + 1) * step,
    count: 0,
  }));

  let belowDomainCount = 0;
  let aboveDomainCount = 0;
  for (const v of values) {
    let idx = Math.floor((v - start) / step);
    if (idx < 0) {
      belowDomainCount++;
      idx = 0;
    } else if (idx >= binCount) {
      if (v > end) aboveDomainCount++;
      idx = binCount - 1;
    }
    bins[idx].count += 1;
  }

  return { bins, p5, p50, p95, belowDomainCount, aboveDomainCount, sd };
}
