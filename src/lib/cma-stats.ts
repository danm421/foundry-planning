export interface MonthlyBar {
  /** Month key "YYYY-MM" (or a full "YYYY-MM-DD" date — only YYYY-MM is used). */
  date: string;
  adjClose: number;
}

export interface MonthlyReturn {
  date: string;
  r: number;
}

const monthKey = (d: string): string => d.slice(0, 7);

/** Simple month-over-month returns from adjusted closes, sorted ascending by month. */
export function monthlyReturns(bars: MonthlyBar[]): MonthlyReturn[] {
  const sorted = [...bars]
    .map((b) => ({ date: monthKey(b.date), adjClose: b.adjClose }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: MonthlyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].adjClose;
    out.push({ date: sorted[i].date, r: sorted[i].adjClose / prev - 1 });
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function annualizedArithmetic(returns: number[]): number {
  return mean(returns) * 12;
}

export function annualizedGeometric(returns: number[]): number {
  const growth = returns.reduce((p, r) => p * (1 + r), 1);
  return Math.pow(growth, 12 / returns.length) - 1;
}

export function annualizedVolatility(returns: number[]): number {
  const m = mean(returns);
  const variance =
    returns.reduce((s, r) => s + (r - m) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}
