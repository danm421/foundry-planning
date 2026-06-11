import type { PortfolioHoldingSeries } from "@/lib/ticker-portfolio-service";

export interface AlignedWindows {
  a: PortfolioHoldingSeries[];
  b: PortfolioHoldingSeries[];
  windowStart: string | null;
  windowEnd: string | null;
  nMonths: number;
}

/** Dates present in EVERY series of the list (empty list → empty set). */
function commonDates(series: readonly PortfolioHoldingSeries[]): Set<string> {
  if (series.length === 0) return new Set();
  let acc: Set<string> = new Set(series[0].returns.map((r) => r.date));
  for (let i = 1; i < series.length; i++) {
    const dates = new Set(series[i].returns.map((r) => r.date));
    acc = new Set([...acc].filter((d) => dates.has(d)));
  }
  return acc;
}

const filterTo = (series: readonly PortfolioHoldingSeries[], keep: Set<string>) =>
  series.map((sr) => ({ ...sr, returns: sr.returns.filter((r) => keep.has(r.date)) }));

export function alignToCommonWindow(
  a: readonly PortfolioHoldingSeries[],
  b: readonly PortfolioHoldingSeries[],
): AlignedWindows {
  const aDates = commonDates(a);
  const bDates = commonDates(b);
  const common = new Set([...aDates].filter((d) => bDates.has(d)));
  const sorted = [...common].sort();

  return {
    a: filterTo(a, common),
    b: filterTo(b, common),
    windowStart: sorted[0] ?? null,
    windowEnd: sorted[sorted.length - 1] ?? null,
    nMonths: sorted.length,
  };
}
