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

export interface EntityFlowDetailRow {
  id: string;
  name: string;
  amount: number;
  isOverride: boolean;
}

export interface EntityFlowDetail {
  incomeRows: EntityFlowDetailRow[];
  expenseRows: EntityFlowDetailRow[];
}

/** Per-source detail rows that sum to the same totals as resolveEntityFlows.
 *  See `resolveEntityFlows.withDetail` (the public attached method) for usage. */
function resolveEntityFlowsDetail(
  entityId: string,
  incomes: Income[],
  expenses: Expense[],
  year: number,
  overrides: EntityFlowOverride[],
  flowMode: EntityFlowMode,
): EntityFlowDetail {
  if (flowMode === "schedule") {
    const ovr = overrides.find((o) => o.entityId === entityId && o.year === year);
    const incomeRows: EntityFlowDetailRow[] = [];
    const expenseRows: EntityFlowDetailRow[] = [];
    if (ovr?.incomeAmount != null && ovr.incomeAmount !== 0) {
      incomeRows.push({
        id: `schedule:${entityId}:${year}:income`,
        name: "Schedule income",
        amount: ovr.incomeAmount,
        isOverride: true,
      });
    }
    if (ovr?.expenseAmount != null && ovr.expenseAmount !== 0) {
      expenseRows.push({
        id: `schedule:${entityId}:${year}:expense`,
        name: "Schedule expense",
        amount: ovr.expenseAmount,
        isOverride: true,
      });
    }
    return { incomeRows, expenseRows };
  }

  const ovr = overrides.find((o) => o.entityId === entityId && o.year === year);
  const incomeRows: EntityFlowDetailRow[] = [];
  for (const inc of incomes) {
    if (inc.ownerEntityId !== entityId) continue;
    const amount = resolveEntityFlowAmount(inc, entityId, "income", year, overrides, flowMode);
    incomeRows.push({
      id: inc.id,
      name: inc.name,
      amount,
      isOverride: ovr?.incomeAmount != null,
    });
  }
  const expenseRows: EntityFlowDetailRow[] = [];
  for (const exp of expenses) {
    if (exp.ownerEntityId !== entityId) continue;
    const amount = resolveEntityFlowAmount(exp, entityId, "expense", year, overrides, flowMode);
    expenseRows.push({
      id: exp.id,
      name: exp.name,
      amount,
      isOverride: ovr?.expenseAmount != null,
    });
  }
  return { incomeRows, expenseRows };
}

/** Resolve total entity income & expense for a business entity in year Y.
 *
 *  Schedule mode is the source-of-truth for the schedule grid: the engine
 *  reads the (entityId, year) override row's incomeAmount/expenseAmount
 *  scalars directly. Base income/expense rows are NOT consulted — this
 *  means a user can populate the grid without first creating placeholder
 *  base rows, and the projection still picks up those flows.
 *
 *  Annual mode keeps the legacy behavior: iterate over base rows where
 *  ownerEntityId matches, applying per-year overrides (sparse) on top.
 *
 *  Hot path: this is called once per business entity per projection year,
 *  so we sum directly instead of building per-source rows that immediately
 *  get discarded. The detail path lives on `resolveEntityFlows.withDetail`. */
export function resolveEntityFlows(
  entityId: string,
  incomes: Income[],
  expenses: Expense[],
  year: number,
  overrides: EntityFlowOverride[] = [],
  flowMode: EntityFlowMode = "annual",
): { income: number; expense: number } {
  if (flowMode === "schedule") {
    const ovr = overrides.find((o) => o.entityId === entityId && o.year === year);
    return {
      income: ovr?.incomeAmount ?? 0,
      expense: ovr?.expenseAmount ?? 0,
    };
  }
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
  return { income, expense };
}

/** Per-source detail rows that sum to the same totals as resolveEntityFlows.
 *  Use for ledger drill-downs that need to attribute income/expense to
 *  specific base rows or schedule overrides. */
resolveEntityFlows.withDetail = function withDetail(
  entityId: string,
  incomes: Income[],
  expenses: Expense[],
  year: number,
  overrides: EntityFlowOverride[] = [],
  flowMode: EntityFlowMode = "annual",
): EntityFlowDetail {
  return resolveEntityFlowsDetail(
    entityId,
    incomes,
    expenses,
    year,
    overrides,
    flowMode,
  );
};

/** Sum of (income amounts − expense amounts) for the given business entity in
 *  year Y. Negative result means the entity ran a loss this year (P3-8:
 *  losses are retained in the entity, not carried forward). */
export function computeBusinessEntityNetIncome(
  entityId: string,
  incomes: Income[],
  expenses: Expense[],
  year: number,
  overrides: EntityFlowOverride[] = [],
  flowMode: EntityFlowMode = "annual",
): number {
  const { income, expense } = resolveEntityFlows(
    entityId,
    incomes,
    expenses,
    year,
    overrides,
    flowMode,
  );
  return income - expense;
}
