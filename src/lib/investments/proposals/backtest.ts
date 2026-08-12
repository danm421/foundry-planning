import { blendedMonthlyReturns, maxDrawdown } from "@/lib/portfolio-stats";
import { MIN_MONTHS } from "@/lib/ticker-portfolio-service";
import type { AlignedWindows } from "@/lib/investments/rebalance/common-window";
import type { MonthlyReturn } from "@/lib/cma-stats";
import type { BacktestPoint, BacktestSeries, StressWindow } from "./types";

const DEFAULT_START_VALUE = 100_000;

/** `MonthlyReturn.date` is `YYYY-MM-01`; windows are compared on `YYYY-MM`. */
const ym = (date: string): string => date.slice(0, 7);

function compound(returns: readonly MonthlyReturn[], startValue: number): BacktestPoint[] {
  const points: BacktestPoint[] = [];
  let value = startValue;
  // The opening point anchors both lines at the same place so the chart reads
  // as "same dollar in, different dollar out".
  if (returns.length > 0) points.push({ date: ym(returns[0].date), value });
  for (const r of returns) {
    value *= 1 + r.r;
    points.push({ date: ym(r.date), value });
  }
  return points;
}

/**
 * Growth of a fixed starting amount through both portfolios over the months
 * they share. Null below MIN_MONTHS — a line drawn from eleven months of
 * history looks exactly as authoritative as one drawn from twenty years.
 */
export function buildBacktestSeries(
  aligned: AlignedWindows,
  startValue: number = DEFAULT_START_VALUE,
): BacktestSeries | null {
  if (aligned.nMonths < MIN_MONTHS || !aligned.windowStart || !aligned.windowEnd) {
    return null;
  }
  const current = compound(blendedMonthlyReturns(aligned.a), startValue);
  const proposed = compound(blendedMonthlyReturns(aligned.b), startValue);

  return {
    windowStart: ym(aligned.windowStart),
    windowEnd: ym(aligned.windowEnd),
    nMonths: aligned.nMonths,
    startValue,
    current,
    proposed,
    endingCurrent: current[current.length - 1]?.value ?? startValue,
    endingProposed: proposed[proposed.length - 1]?.value ?? startValue,
  };
}

export const STRESS_WINDOWS = [
  { key: "gfc", label: "Global financial crisis", start: "2007-11", end: "2009-02" },
  { key: "covid", label: "COVID crash", start: "2020-01", end: "2020-03" },
  { key: "rates2022", label: "2022 rate shock", start: "2022-01", end: "2022-09" },
] as const;

/** Inclusive month count between two `YYYY-MM` strings. */
function monthSpan(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

const cumulative = (rs: readonly MonthlyReturn[]): number =>
  rs.reduce((acc, r) => acc * (1 + r.r), 1) - 1;

/**
 * How each portfolio would have fared through three historical shocks.
 *
 * A window counts only when BOTH sides cover every month of it. Partial
 * coverage is reported as unavailable rather than computed: a crisis window
 * that starts halfway through shows a smaller decline than actually happened,
 * and an omitted window reads to a client as "it did fine".
 */
export function buildStressWindows(
  aligned: AlignedWindows,
  totalValue: number,
): StressWindow[] {
  const cur = blendedMonthlyReturns(aligned.a);
  const prop = blendedMonthlyReturns(aligned.b);

  return STRESS_WINDOWS.map((w) => {
    const slice = (rs: readonly MonthlyReturn[]) =>
      rs.filter((r) => ym(r.date) >= w.start && ym(r.date) <= w.end);
    const c = slice(cur);
    const p = slice(prop);
    const expected = monthSpan(w.start, w.end);
    const available = c.length === expected && p.length === expected;

    if (!available) {
      return {
        key: w.key,
        label: w.label,
        start: w.start,
        end: w.end,
        available: false,
        unavailableReason: "One or more holdings launched after this period.",
        currentReturn: null,
        proposedReturn: null,
        currentDrawdown: null,
        proposedDrawdown: null,
        currentDollars: null,
        proposedDollars: null,
      };
    }

    const cReturn = cumulative(c);
    const pReturn = cumulative(p);
    return {
      key: w.key,
      label: w.label,
      start: w.start,
      end: w.end,
      available: true,
      unavailableReason: null,
      currentReturn: cReturn,
      proposedReturn: pReturn,
      currentDrawdown: maxDrawdown(c.map((r) => r.r)),
      proposedDrawdown: maxDrawdown(p.map((r) => r.r)),
      currentDollars: totalValue * cReturn,
      proposedDollars: totalValue * pReturn,
    };
  });
}
