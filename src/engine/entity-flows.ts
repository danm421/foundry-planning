import type { Income, Expense, EntityFlowOverride, EntityFlowMode, EntitySummary } from "./types";

interface BaseRow {
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  inflationStartYear?: number;
}

/** Resolve an entity-owned income or expense row to its year amount.
 *
 *  When the entity is in 'schedule' mode (flowMode === 'schedule'):
 *    Use the override cell value or 0. Base+growth is NOT consulted.
 *
 *  When the entity is in 'annual' mode (flowMode === 'annual', the default):
 *    1. Override cell wins if non-null (sparse override semantics).
 *    2. Otherwise base+growth within [startYear, endYear].
 *    3. 0 outside the row's window.
 *
 *  Per-row scheduleOverrides on entity-owned rows is intentionally NOT consulted
 *  here (P2-3 — Phase 2 replaces that path). Non-entity rows go through the
 *  legacy resolution paths in src/engine/income.ts / expenses.ts. */
export function resolveEntityFlowAmount(
  row: BaseRow,
  entityId: string,
  field: "income" | "expense",
  year: number,
  overrides: EntityFlowOverride[],
  flowMode: EntityFlowMode = "annual",
): number {
  const ovr = overrides.find((o) => o.entityId === entityId && o.year === year);
  const ovrAmount = field === "income" ? ovr?.incomeAmount : ovr?.expenseAmount;
  if (flowMode === "schedule") return ovrAmount ?? 0;
  if (ovrAmount != null) return ovrAmount;
  if (year < row.startYear || year > row.endYear) return 0;
  const inflateFrom = row.inflationStartYear ?? row.startYear;
  return row.annualAmount * Math.pow(1 + row.growthRate, year - inflateFrom);
}

/** Resolve the distribution percent for a business entity in a given year.
 *  Order of resolution:
 *    'schedule' mode: per-year override.distributionPercent, else 0 (no fallback).
 *    'annual' mode (default):
 *      1. Phase 2 override.distributionPercent (non-null).
 *      2. entity.distributionPolicyPercent (non-null).
 *      3. 1.0 (P3-5 default — full passthrough).
 *
 *  Trusts ignore distribution percent entirely; callers should gate on
 *  entity.entityType !== "trust" before invoking this. */
export function resolveDistributionPercent(
  entity: EntitySummary,
  year: number,
  overrides: EntityFlowOverride[],
): number {
  const ovr = overrides.find((o) => o.entityId === entity.id && o.year === year);
  if (entity.flowMode === "schedule") return ovr?.distributionPercent ?? 0;
  if (ovr?.distributionPercent != null) return ovr.distributionPercent;
  if (entity.distributionPolicyPercent != null) return entity.distributionPolicyPercent;
  return 1.0;
}

/** Sum of (income amounts − expense amounts) for the given business entity in
 *  year Y. Counts rows where ownerEntityId matches; values resolved via
 *  resolveEntityFlowAmount.
 *  Negative result means the entity ran a loss this year (P3-8: losses are
 *  retained in the entity, not carried forward). */
export function computeBusinessEntityNetIncome(
  entityId: string,
  incomes: Income[],
  expenses: Expense[],
  year: number,
  overrides: EntityFlowOverride[] = [],
  flowMode: EntityFlowMode = "annual",
): number {
  let income = 0;
  for (const inc of incomes) {
    if (inc.ownerEntityId !== entityId) continue;
    income += resolveEntityFlowAmount(inc, entityId, "income", year, overrides, flowMode);
  }
  let expense = 0;
  for (const exp of expenses) {
    if (exp.ownerEntityId !== entityId) continue;
    expense += resolveEntityFlowAmount(exp, entityId, "expense", year, overrides, flowMode);
  }
  return income - expense;
}
