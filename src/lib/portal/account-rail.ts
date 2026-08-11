/**
 * Pure rail model for the portal Accounts page. Single source of truth for the
 * category label/order maps that `profile-accounts-list.tsx` and
 * `profile-debt-list.tsx` used to duplicate.
 *
 * No IO, no React — the rail is derived from an already-loaded DTO so it can be
 * unit-tested in plain vitest.
 */
import type { PortalAccountRow, PortalDebtRow } from "@/lib/portal/contracts";

export const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real estate",
  business: "Business",
  stock_options: "Stock options",
  life_insurance: "Life insurance",
  notes_receivable: "Notes receivable",
};

/**
 * Full planning taxonomy, not the portal-visible subset. `isPortalVisibleAccount()`
 * admits only cash/taxable/retirement/real_estate today, so the tail of this list is
 * unreachable from this page — it stays complete so a future widening of
 * PORTAL_VISIBLE_CATEGORIES needs no change here.
 */
export const CATEGORY_ORDER = [
  "cash",
  "taxable",
  "retirement",
  "annuity",
  "real_estate",
  "business",
  "stock_options",
  "life_insurance",
  "notes_receivable",
] as const;

/**
 * One Deep Jewel hue per asset category, keyed rather than positional so a
 * category keeps its color when a sibling appears or drops out. Overlaps with
 * `--color-alloc-*` deliberately (cash → yellow, real estate → orange) so the
 * net-worth breakdown and the allocation donut don't disagree on a shared
 * concept. Red goes to the smallest of these — on a money surface it reads as
 * a loss, so it shouldn't land on a category clients see every day.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  cash: "var(--data-yellow)",
  taxable: "var(--data-blue)",
  retirement: "var(--data-green)",
  annuity: "var(--data-teal)",
  real_estate: "var(--data-orange)",
  business: "var(--data-purple)",
  stock_options: "var(--data-pink)",
  life_insurance: "var(--data-red)",
  notes_receivable: "var(--data-grey)",
};

export const TYPE_LABEL: Record<string, string> = {
  mortgage: "Mortgage",
  heloc: "HELOC",
  auto: "Auto loan",
  student: "Student loan",
  personal: "Personal loan",
  credit_card: "Credit card",
  other: "Loan",
};

export const TYPE_ORDER = [
  "mortgage",
  "heloc",
  "auto",
  "student",
  "personal",
  "credit_card",
  "other",
] as const;

export type RailGroupKind = "asset" | "liability";

export interface RailRow {
  /** Stable selection key — "asset:cash", "liability:mortgage". */
  key: string;
  kind: RailGroupKind;
  /** Raw account category, or liabilityType bucket. */
  category: string;
  label: string;
  /** Always positive; the liability sign is a display concern. */
  total: number;
}

export interface RailGroup {
  total: number;
  rows: RailRow[];
}

export interface AccountRail {
  netWorth: number;
  assets: RailGroup;
  liabilities: RailGroup;
}

/** Known keys first in canonical order, then anything unrecognised, input-order. */
function orderedKeys(present: string[], order: readonly string[]): string[] {
  return [
    ...order.filter((k) => present.includes(k)),
    ...present.filter((k) => !order.includes(k)),
  ];
}

function sumBy<T>(items: T[], keyOf: (t: T) => string, valueOf: (t: T) => number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const k = keyOf(item);
    totals.set(k, (totals.get(k) ?? 0) + valueOf(item));
  }
  return totals;
}

export function buildAccountRail({
  assets,
  debts,
}: {
  assets: PortalAccountRow[];
  debts: PortalDebtRow[];
}): AccountRail {
  const assetTotals = sumBy(assets, (a) => a.category, (a) => a.value);
  // A liability with no type is a plain loan — same fallback profile-debt-list used.
  const debtTotals = sumBy(debts, (d) => d.liabilityType ?? "other", (d) => d.balance);

  const assetRows: RailRow[] = orderedKeys([...assetTotals.keys()], CATEGORY_ORDER).map((c) => ({
    key: `asset:${c}`,
    kind: "asset",
    category: c,
    label: CATEGORY_LABELS[c] ?? c,
    total: assetTotals.get(c) ?? 0,
  }));

  const liabilityRows: RailRow[] = orderedKeys([...debtTotals.keys()], TYPE_ORDER).map((c) => ({
    key: `liability:${c}`,
    kind: "liability",
    category: c,
    label: TYPE_LABEL[c] ?? "Loan",
    total: debtTotals.get(c) ?? 0,
  }));

  const assetsTotal = assetRows.reduce((s, r) => s + r.total, 0);
  const liabilitiesTotal = liabilityRows.reduce((s, r) => s + r.total, 0);

  return {
    netWorth: assetsTotal - liabilitiesTotal,
    assets: { total: assetsTotal, rows: assetRows },
    liabilities: { total: liabilitiesTotal, rows: liabilityRows },
  };
}

/**
 * Asset-side category subtotals for the dashboard's net-worth tile.
 *
 * Lives here, beside `buildAccountRail`, so the "known categories in
 * CATEGORY_ORDER, then anything unrecognised" rule and the `?? category` label
 * fallback have exactly one definition. The dashboard tile is meant to read the
 * same way as the Accounts rail; a second copy of the ordering rule is how the
 * two would quietly stop agreeing.
 *
 * Takes bare category/value pairs rather than `PortalAccountRow[]` because the
 * dashboard loader has only those two columns for its visible accounts.
 */
export function assetCategoryTotals(
  rows: { category: string; value: number }[],
): { category: string; label: string; total: number }[] {
  const totals = sumBy(rows, (r) => r.category, (r) => r.value);
  return orderedKeys([...totals.keys()], CATEGORY_ORDER).map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c] ?? c,
    total: totals.get(c) ?? 0,
  }));
}

export function assetCardSubtitle(a: PortalAccountRow): string {
  return `${CATEGORY_LABELS[a.category] ?? a.category} · ${a.subType.replace(/_/g, " ")}`;
}

export function debtCardSubtitle(d: PortalDebtRow): string {
  return d.liabilityType ? TYPE_LABEL[d.liabilityType] ?? "Loan" : "Loan";
}
