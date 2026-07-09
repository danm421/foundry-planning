// src/lib/portal/category-detail.ts
//
// Pure compute for the portal Budget category-detail panel. NO DB/Next imports
// (unit-testable in plain vitest). The DB loader (load-category-detail.ts) hands
// us a month -> signed-spend map; we turn it into chart bars + key metrics.
//
// Sign convention (inherited from plaidTransactions): positive = money OUT
// (spend), so a category's monthly spend is the signed sum and refunds net down.

export type Heat = "good" | "warn" | "crit" | "none";

export type HistoryBar = { month: string; amount: number; heat: Heat };
export type YearMetric = { year: number; total: number; avgMonthly: number };

export type CategoryTransaction = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  merchantName: string | null;
  amount: number; // signed; positive = spend
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string;
};

export type CategoryDetail = {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  emoji: string;
  kind: "group" | "category";
  monthlyBudget: number | null;
  spentThisMonth: number;
  remainingThisMonth: number | null; // null when no budget
  history: HistoryBar[];
  metrics: YearMetric[];
  transactions: CategoryTransaction[];
};

const WARN_RATIO = 0.85; // >= this fraction of budget reads amber

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Heat for one month's spend relative to the category's monthly budget. */
export function barHeat(amount: number, budget: number | null): Heat {
  if (budget == null || budget <= 0) return "none";
  const ratio = amount / budget;
  if (ratio >= 1) return "crit";
  if (ratio >= WARN_RATIO) return "warn";
  return "good";
}

/**
 * The last `n` "YYYY-MM" months ending at `now`'s month, oldest first. Uses UTC
 * to stay consistent with the date-only `plaidTransactions.date` column.
 */
export function monthsWindow(now: Date, n: number): string[] {
  const out: string[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${d.getUTCFullYear()}-${mm}`);
  }
  return out;
}

/** Project a month->spend map onto a continuous window, zero-filling gaps. */
export function buildHistory(
  byMonth: Record<string, number>,
  months: string[],
  budget: number | null,
): HistoryBar[] {
  return months.map((month) => {
    const amount = round2(byMonth[month] ?? 0);
    return { month, amount, heat: barHeat(amount, budget) };
  });
}

/**
 * Per-year totals + average over the months that actually have data (so a
 * partial current year averages over elapsed active months, not a flat /12).
 * Newest year first.
 */
export function computeYearMetrics(byMonth: Record<string, number>): YearMetric[] {
  const totals = new Map<number, { total: number; months: number }>();
  for (const [month, amount] of Object.entries(byMonth)) {
    const year = Number(month.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const cur = totals.get(year) ?? { total: 0, months: 0 };
    cur.total += amount;
    cur.months += 1;
    totals.set(year, cur);
  }
  return [...totals.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, { total, months }]) => ({
      year,
      total: round2(total),
      avgMonthly: months > 0 ? round2(total / months) : 0,
    }));
}
