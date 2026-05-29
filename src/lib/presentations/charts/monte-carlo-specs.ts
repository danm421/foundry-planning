import { ticks } from "d3-array";
import { PRESENTATION_THEME as T } from "../theme";
import type { MonteCarloSummary } from "@/engine";
import type { HistogramSeries } from "@/lib/monte-carlo/histogram-series";

type Margin = { top: number; right: number; bottom: number; left: number };

// All three charts share the same canvas size + vertical margins; only the
// left gutter varies with the y-axis label width.
const BASE = { width: 540, height: 300 } as const;
function margin(left: number): Margin {
  return { top: 20, right: 16, bottom: 40, left };
}

function niceCeiling(v: number): number {
  if (v <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / magnitude) * magnitude;
}

// ── Fan chart ────────────────────────────────────────────────────────────────
export interface FanChartSpec {
  width: number;
  height: number;
  margin: Margin;
  years: number[];
  xTicks: number[];
  yDomain: [number, number];
  yTicks: number[];
  band: { upper: number[]; lower: number[] };
  median: number[];
  deterministic: number[] | null;
  markers: Array<{ atYear: number; label: string }>;
  colors: {
    band: string;
    bandStroke: string;
    median: string;
    deterministic: string;
    grid: string;
    axis: string;
    marker: string;
  };
}

export interface BuildFanChartSpecInput {
  byYear: MonteCarloSummary["byYear"];
  deterministic: number[] | null;
  markers: Array<{ atYear: number; label: string }>;
}

export function buildFanChartSpec(input: BuildFanChartSpecInput): FanChartSpec {
  const { byYear, deterministic, markers } = input;
  const years = byYear.map((r) => r.year);
  const upper = byYear.map((r) => r.balance.p80);
  const lower = byYear.map((r) => r.balance.p20);
  const median = byYear.map((r) => r.balance.p50);

  const yMaxRaw = Math.max(1, ...upper, ...(deterministic ?? []));
  const yDomainMax = niceCeiling(yMaxRaw * 1.05);
  const xTicks = years.length <= 8 ? years : ticks(years[0], years[years.length - 1], 8);

  return {
    ...BASE,
    margin: margin(64),
    years,
    xTicks,
    yDomain: [0, yDomainMax],
    yTicks: ticks(0, yDomainMax, 5),
    band: { upper, lower },
    median,
    deterministic: deterministic ?? null,
    markers,
    colors: {
      band: T.steel,
      bandStroke: T.steel,
      median: T.ink,
      deterministic: T.accent,
      grid: T.hair,
      axis: T.ink3,
      marker: T.accent,
    },
  };
}

// ── Histogram ──────────────────────────────────────────────────────────────
export interface HistogramChartSpec {
  width: number;
  height: number;
  margin: Margin;
  bins: Array<{ x0: number; x1: number; count: number }>;
  xDomain: [number, number];
  yDomain: [number, number];
  yTicks: number[];
  percentileMarkers: Array<{ value: number; label: string; emphasis: boolean }>;
  belowDomainCount: number;
  aboveDomainCount: number;
  colors: { bar: string; marker: string; markerEmphasis: string; grid: string; axis: string };
}

export function buildHistogramChartSpec(series: HistogramSeries): HistogramChartSpec {
  const bins = series.bins.map((b) => ({ x0: b.min, x1: b.max, count: b.count }));
  const x0 = bins.length ? bins[0].x0 : 0;
  const x1 = bins.length ? bins[bins.length - 1].x1 : 1;
  const yMax = Math.max(1, ...bins.map((b) => b.count));
  const yDomainMax = niceCeiling(yMax * 1.1);

  const percentileMarkers = [
    { value: series.p5, label: "P5", emphasis: false },
    { value: series.p25, label: "P25", emphasis: false },
    { value: series.p50, label: "P50", emphasis: true },
    { value: series.p75, label: "P75", emphasis: false },
    { value: series.p95, label: "P95", emphasis: false },
  ];

  return {
    ...BASE,
    margin: margin(56),
    bins,
    xDomain: [x0, x1],
    yDomain: [0, yDomainMax],
    yTicks: ticks(0, yDomainMax, 5),
    percentileMarkers,
    belowDomainCount: series.belowDomainCount,
    aboveDomainCount: series.aboveDomainCount,
    colors: { bar: T.steel, marker: T.ink3, markerEmphasis: T.accent, grid: T.hair, axis: T.ink3 },
  };
}

// ── Success over time (longevity) ─────────────────────────────────────────────
export interface SuccessChartSpec {
  width: number;
  height: number;
  margin: Margin;
  bars: Array<{ label: string; value: number; color: string }>;
  labelEvery: number;
  colors: { grid: string; axis: string };
}

export interface BuildSuccessChartSpecInput {
  successRates: number[];
  years: number[];
  ages: Array<number | null>;
}

// Report-palette mapping of the app's green/yellow/orange/red thresholds.
function successColor(rate: number): string {
  if (rate >= 0.9) return T.good; // green
  if (rate >= 0.75) return T.accent; // gold
  if (rate >= 0.5) return "#c8772e"; // muted orange (between accent + crit)
  return T.crit; // red
}

export function buildSuccessChartSpec(input: BuildSuccessChartSpecInput): SuccessChartSpec {
  const { successRates, years, ages } = input;
  const bars = successRates.map((value, i) => {
    const age = ages[i];
    const label = age != null ? String(age) : String(years[i] ?? i);
    return { label, value, color: successColor(value) };
  });
  const labelEvery = bars.length <= 12 ? 1 : Math.ceil(bars.length / 12);
  return {
    ...BASE,
    margin: margin(44),
    bars,
    labelEvery,
    colors: { grid: T.hair, axis: T.ink3 },
  };
}
