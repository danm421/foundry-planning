// src/lib/portal/networth-trend.ts
import type { TrendPoint } from "@/lib/portal/contracts";
export type { TrendPoint };

export interface TrendTransaction {
  date: string; // yyyy-mm-dd
  amount: number; // Plaid sign: positive = money OUT
}
export type TrendWindow = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

function toUtc(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function prevDay(d: string): string {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() - 1);
  return fmt(x);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * netWorth(T) = netWorthNow + Σ amount(t) for tracked transactions dated
 * strictly after day T. Walk backward day-by-day from asOfDate: leaving a day
 * adds that day's transaction total to the running balance.
 */
export function reconstructDailyNetWorth(params: {
  netWorthNow: number;
  asOfDate: string;
  startDate: string;
  transactions: TrendTransaction[];
}): TrendPoint[] {
  const { netWorthNow, asOfDate, startDate, transactions } = params;
  const byDay = new Map<string, number>();
  for (const t of transactions) {
    if (t.date > asOfDate) continue; // ignore future-dated
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  }
  const desc: TrendPoint[] = [];
  let value = netWorthNow;
  for (let d = asOfDate; d >= startDate; d = prevDay(d)) {
    desc.push({ date: d, netWorth: round2(value) });
    value += byDay.get(d) ?? 0; // moving to the previous day
  }
  return desc.reverse();
}

function windowCutoff(window: TrendWindow, asOfDate: string): string {
  if (window === "ALL") return "0000-01-01";
  const d = toUtc(asOfDate);
  switch (window) {
    case "1W": d.setUTCDate(d.getUTCDate() - 7); break;
    case "1M": d.setUTCMonth(d.getUTCMonth() - 1); break;
    case "3M": d.setUTCMonth(d.getUTCMonth() - 3); break;
    case "1Y": d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case "YTD": return `${asOfDate.slice(0, 4)}-01-01`;
  }
  return fmt(d);
}

export function sliceSeriesToWindow(
  series: TrendPoint[],
  window: TrendWindow,
  asOfDate: string,
): TrendPoint[] {
  const cutoff = windowCutoff(window, asOfDate);
  return series.filter((p) => p.date >= cutoff);
}

/**
 * Y-axis bounds for a trend chart. Auto-scaling hugs the data, so a household
 * whose net worth moved $3k across the year gets $1k gridlines and a line that
 * swings corner-to-corner — a rounding error drawn as a cliff. Snap the axis to
 * a $5k grid instead, stepping up through 1/2/5 multiples so the labels stay
 * round no matter how large the balance sheet.
 */
const FINEST_STEP = 5_000;
const MAX_GRIDLINES = 6;

export function trendAxisBounds(
  values: number[],
): { min: number; max: number; stepSize: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: FINEST_STEP, stepSize: FINEST_STEP };

  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const step = gridStep(hi - lo);
  // `|| 0` scrubs the -0 that Math.ceil hands back just below zero — Intl
  // would print that tick as "-$0".
  const min = Math.floor(lo / step) * step || 0;
  const max = Math.ceil(hi / step) * step || 0;
  return { min, max: max === min ? min + step : max, stepSize: step };
}

/** Smallest 1/2/5-style multiple of $5k that spans `range` in ≤ 6 gridlines. */
function gridStep(range: number): number {
  for (let decade = FINEST_STEP; decade <= FINEST_STEP * 1e9; decade *= 10) {
    for (const m of [1, 2, 5]) {
      if (range / (decade * m) <= MAX_GRIDLINES) return decade * m;
    }
  }
  return FINEST_STEP * 1e9;
}
