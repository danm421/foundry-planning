// src/lib/living-expense-items.ts
//
// The rules behind an itemized Current Living Expenses row (spec
// 2026-10-07-living-expense-items-design). The projection never reads the items
// — it reads the row's `annualAmount` — so everything here keeps that one
// number and the list in step:
//
//   - `livingItemsAnnualTotal` is THE sum. The page, both server write paths
//     and the tests call it; nothing else re-derives it.
//   - `livingItemsPatch` is what the page sends for any item edit: the list and
//     its total together.
//   - `withLivingItemsTotal` is the server's copy of the same rule, so a caller
//     that sends items without a total (the AI connector, a stale tab) still
//     stores a matching one.
//   - A total that DIFFERS from the items is legal: another screen set it, and
//     it wins (`isTotalOverridden`). The items stay until the advisor edits one.

import type { LivingExpenseItem } from "@/engine/types";

export const MAX_LIVING_ITEMS = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One item's yearly amount: a monthly item counts twelve times. */
export function itemAnnualAmount(item: Pick<LivingExpenseItem, "amount" | "frequency">): number {
  return round2(item.frequency === "monthly" ? item.amount * 12 : item.amount);
}

/** The items' yearly total, to the cent. An empty list totals 0. */
export function livingItemsAnnualTotal(items: readonly LivingExpenseItem[]): number {
  return round2(items.reduce((sum, item) => sum + itemAnnualAmount(item), 0));
}

/** `null`, `undefined` and `[]` all mean "not itemized". */
export function hasLivingItems(
  items: readonly LivingExpenseItem[] | null | undefined,
): items is LivingExpenseItem[] {
  return items != null && items.length > 0;
}

/** True when another screen set a total that differs from the items' sum. */
export function isTotalOverridden(
  annualAmount: number | string,
  items: readonly LivingExpenseItem[] | null | undefined,
): boolean {
  if (!hasLivingItems(items)) return false;
  return Math.abs(round2(Number(annualAmount)) - livingItemsAnnualTotal(items)) >= 0.005;
}

/** The write for any item edit: the list and its total travel together. The
 *  last item deleted leaves the row un-itemized at $0. */
export function livingItemsPatch(items: readonly LivingExpenseItem[]): {
  livingItems: LivingExpenseItem[] | null;
  annualAmount: string;
} {
  return hasLivingItems(items)
    ? { livingItems: [...items], annualAmount: String(livingItemsAnnualTotal(items)) }
    : { livingItems: null, annualAmount: "0" };
}

/** Same items in the same order. `null`, `undefined` and `[]` are all "none". */
function sameLivingItems(
  a: readonly LivingExpenseItem[] | null | undefined,
  b: readonly LivingExpenseItem[] | null | undefined,
): boolean {
  const key = (items: readonly LivingExpenseItem[] | null | undefined) =>
    JSON.stringify((items ?? []).map((i) => [i.id, i.name, i.amount, i.frequency]));
  return key(a) === key(b);
}

/**
 * Server half of the same rule, for a write that MAY carry `livingItems`:
 * absent → untouched; empty → stored as null and the caller's total stands;
 * non-empty → the total is set to the items' sum, whatever the caller sent —
 * unless the items equal the row's `current` ones. A whole-row re-save (the
 * Solver's "Update scenario") carries unchanged items beside a total typed on
 * another screen, and that total wins (spec rule 2). Omit `current` for a new
 * row.
 */
export function withLivingItemsTotal<
  T extends { livingItems?: LivingExpenseItem[] | null; annualAmount?: unknown },
>(fields: T, current?: readonly LivingExpenseItem[] | null): T {
  if (fields.livingItems === undefined) return fields;
  if (!hasLivingItems(fields.livingItems)) return { ...fields, livingItems: null } as T;
  if (current !== undefined && sameLivingItems(fields.livingItems, current)) return fields;
  return { ...fields, annualAmount: String(livingItemsAnnualTotal(fields.livingItems)) } as T;
}

/** What "Make it a goal" pre-fills in the expense editor. */
export interface GoalPrefill {
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
  growthRate: string;
  growthSource: string | null;
  inflationStartYear: number | null;
}

/** The goal an item becomes: its name and yearly amount, on the living row's
 *  own years and growth as a starting point the advisor then adjusts. */
export function goalPrefillFromItem(
  item: LivingExpenseItem,
  row: {
    startYear: number;
    endYear: number;
    startYearRef?: string | null;
    endYearRef?: string | null;
    growthRate: string;
    growthSource?: string | null;
    inflationStartYear?: number | null;
  },
): GoalPrefill {
  return {
    name: item.name,
    annualAmount: itemAnnualAmount(item),
    startYear: row.startYear,
    endYear: row.endYear,
    startYearRef: row.startYearRef ?? null,
    endYearRef: row.endYearRef ?? null,
    growthRate: row.growthRate,
    growthSource: row.growthSource ?? null,
    inflationStartYear: row.inflationStartYear ?? null,
  };
}
