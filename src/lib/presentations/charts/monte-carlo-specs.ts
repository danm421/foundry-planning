import { ticks } from "d3-array";
import { PRESENTATION_THEME as T } from "../theme";
import type { MonteCarloSummary } from "@/engine";
import type { HistogramSeries } from "@/lib/monte-carlo/histogram-series";
import { niceAxisMax } from "./axis";

type Margin = { top: number; right: number; bottom: number; left: number };

/** Gap between a y-axis label's right edge and the plot. The charts draw their
 *  labels right-anchored at `x={-Y_TICK_GAP}`, and the left gutter below is
 *  sized around it, so the two cannot drift apart. */
export const Y_TICK_GAP = 6;

/** JetBrains Mono at 7pt, measured off a render rather than assumed: "$6.0M"
 *  came back 21.0pt wide and "350" 12.6pt — 4.2pt per character, both times. */
const MONO_7PT_ADVANCE = 4.2;

/** The widest y-axis label these three charts can print. The fan's is
 *  `compactCurrency`, which has no billions branch, so a $2B portfolio reads
 *  "$2000.0M" — 8 characters. The histogram's trial counts and the success
 *  chart's percentages are all shorter. */
const MAX_Y_LABEL_CHARS = 8;

// All three charts share one canvas and one set of margins.
//
// The left gutter holds the y-axis labels, which are right-anchored and grow
// leftward from the plot, so it has to fit the widest one plus the gap.
//
// It used to be tuned per chart to 64 / 56 / 44 "with the y-axis label width",
// which under the old `start` anchor was inert: the label began at the plot edge
// and ran into the plot, so the gutter it was given changed nothing about where
// it landed. Now that the anchor is right the number is load-bearing, and one
// number covers all three — `chart-axis-geometry.test.tsx` renders a billions
// deck and fails if a label outgrows it.
const BASE = {
  width: 540,
  height: 300,
  margin: {
    top: 20,
    right: 16,
    bottom: 40,
    left: Math.ceil(MAX_Y_LABEL_CHARS * MONO_7PT_ADVANCE + Y_TICK_GAP),
  } satisfies Margin,
} as const;

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
    bandUpper: string;
    bandLower: string;
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
  const yDomainMax = niceAxisMax(yMaxRaw * 1.05);
  const xTicks = years.length <= 8 ? years : ticks(years[0], years[years.length - 1], 8);

  return {
    ...BASE,
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
      bandUpper: T.good, // green — above-average outcome (p80), mirrors the in-app fan chart
      bandLower: T.crit, // red — below-average outcome (p20)
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
  const yDomainMax = niceAxisMax(yMax * 1.1);

  const percentileMarkers = [
    { value: series.p5, label: "P5", emphasis: false },
    { value: series.p25, label: "P25", emphasis: false },
    { value: series.p50, label: "P50", emphasis: true },
    { value: series.p75, label: "P75", emphasis: false },
    { value: series.p95, label: "P95", emphasis: false },
  ];

  return {
    ...BASE,
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
    bars,
    labelEvery,
    colors: { grid: T.hair, axis: T.ink3 },
  };
}
