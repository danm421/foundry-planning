// src/lib/portal/networth-trend.ts
export interface TrendTransaction {
  date: string; // yyyy-mm-dd
  amount: number; // Plaid sign: positive = money OUT
}
export interface TrendPoint {
  date: string;
  netWorth: number;
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
