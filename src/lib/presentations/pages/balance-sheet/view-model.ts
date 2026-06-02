import type { BalanceSheetOptions } from "./options-schema";

const LIQUID_KEYS = new Set(["cash", "taxable", "retirement"]);

/** Liquid portfolio = cash + taxable + retirement category totals. */
export function liquidPortfolioTotal(
  categories: { key: string; total: number }[],
): number {
  return categories
    .filter((c) => LIQUID_KEYS.has(c.key))
    .reduce((sum, c) => sum + c.total, 0);
}

/** Resolve the balance-sheet year: first projection year in `today` mode,
 *  otherwise the selected year clamped to the projection range. */
export function resolveBalanceSheetYear(
  years: { year: number }[],
  options: BalanceSheetOptions,
): number {
  if (years.length === 0) return options.year;
  const first = years[0].year;
  const last = years[years.length - 1].year;
  if (options.asOf === "today") return first;
  return Math.min(Math.max(options.year, first), last);
}
