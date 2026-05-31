import { cholesky } from "@/engine/monteCarlo/cholesky";

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

/** Pearson correlation over months present in BOTH series. */
export function pairwiseCorrelation(
  a: MonthlyReturn[],
  b: MonthlyReturn[],
): { rho: number; overlapMonths: number } {
  const bByMonth = new Map(b.map((x) => [x.date, x.r]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { date, r } of a) {
    const yr = bByMonth.get(date);
    if (yr !== undefined) {
      xs.push(r);
      ys.push(yr);
    }
  }
  const n = xs.length;
  if (n < 2) return { rho: 0, overlapMonths: n };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a0 = xs[i] - mx;
    const b0 = ys[i] - my;
    num += a0 * b0;
    dx += a0 * a0;
    dy += b0 * b0;
  }
  const denom = Math.sqrt(dx * dy);
  return { rho: denom === 0 ? 0 : num / denom, overlapMonths: n };
}

/** True iff `M` is symmetric positive-definite (uses the engine's Cholesky as oracle). */
export function isPSD(M: number[][]): boolean {
  try {
    cholesky(M);
    return true;
  } catch {
    return false;
  }
}

/** Shrink off-diagonals toward 0 by factor (1−alpha); diagonal stays 1. */
function shrinkToIdentity(M: number[][], alpha: number): number[][] {
  return M.map((row, i) =>
    row.map((v, j) => (i === j ? 1 : (1 - alpha) * v)),
  );
}

/**
 * Nearest-PSD via shrinkage toward the identity. Returns the smallest-alpha
 * matrix (1% steps) that passes the Cholesky PSD test, or the identity at alpha=1.
 */
export function repairToPSD(M: number[][]): { matrix: number[][]; alpha: number } {
  if (isPSD(M)) return { matrix: M, alpha: 0 };
  for (let alpha = 0.01; alpha < 1; alpha += 0.01) {
    const candidate = shrinkToIdentity(M, alpha);
    if (isPSD(candidate)) return { matrix: candidate, alpha: Number(alpha.toFixed(2)) };
  }
  return { matrix: shrinkToIdentity(M, 1), alpha: 1 };
}
