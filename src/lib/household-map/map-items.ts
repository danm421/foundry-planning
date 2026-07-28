// src/lib/household-map/map-items.ts
import { formatCurrency } from "@/lib/cell-drill/format";
import type { Account, Expense, Income, SavingsRule } from "@/engine/types";
import { assignColumn } from "./columns";
import { moneyLabel } from "./format";
import type { ColumnAssignment, ColumnContext, MapColumn, MapItem } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Display adapters. Page-shaped, not domain logic: they turn engine rows into
// the flat `MapItem` the boards render. Column placement is the one piece of
// real logic and it lives in `@/lib/household-map/columns`.
// ──────────────────────────────────────────────────────────────────────────

/** Account category → the board's visual category (drives the card's hue). */
export const ACCOUNT_CATEGORY: Record<Account["category"], MapItem["category"]> = {
  taxable: "investments",
  cash: "investments",
  retirement: "investments",
  education_savings: "investments",
  notes_receivable: "investments",
  stock_options: "investments",
  annuity: "investments",
  real_estate: "property",
  business: "property",
  life_insurance: "insurance",
};

/** Accounts and liabilities both carry `owners[]`, so both place via
 *  `assignColumn`. The caller supplies the signed value and the hue because
 *  those are the only two things that differ between them. */
export function toMapItem(
  thing: { id: string; name: string; owners: Account["owners"] },
  kind: "account" | "liability",
  category: MapItem["category"],
  value: number,
  ctx: ColumnContext,
): MapItem {
  return {
    id: thing.id,
    kind,
    category,
    name: thing.name,
    value,
    valueLabel: moneyLabel(value),
    ...assignColumn(thing, ctx),
    noteChip: null,
  };
}

/**
 * Incomes and expenses have no `owners[]` — ownership is a single enum (income)
 * or implicitly the household (expense), plus an optional owning entity. An
 * entity-owned flow trays for the same reason `assignColumn` trays an
 * entity-owned asset: the board has no honest way to draw it in a principal's
 * column.
 */
export function flowAssignment(
  ownerEntityId: string | undefined,
  householdColumn: MapColumn,
  ctx: ColumnContext,
): ColumnAssignment {
  if (ownerEntityId) {
    return {
      column: "tray",
      splitChip: null,
      trayOwnerLabel: ctx.nameByEntityId.get(ownerEntityId) ?? "Entity-owned",
    };
  }
  return { column: householdColumn, splitChip: null, trayOwnerLabel: null };
}

export function incomeToMapItem(income: Income, ctx: ColumnContext): MapItem {
  return {
    id: income.id,
    kind: "income",
    category: "investments",
    name: income.name,
    value: income.annualAmount,
    valueLabel: moneyLabel(income.annualAmount),
    ...flowAssignment(income.ownerEntityId, income.owner, ctx),
    noteChip: null,
  };
}

/**
 * `value` and `valueLabel` MUST come from the same branch — a card that shows
 * one number while the engine subtotals another is the bug this fixes.
 *
 * Mirrors the engine's own resolution order (engine/projection.ts's
 * resolvedByRuleId loop → engine/savings.ts resolveContributionAmount):
 * scheduleOverrides[year] first, then contributeMax (IRS limit), then
 * percent-of-pay, then flat annualAmount. Only the flat-dollar branch is
 * resolvable here — contributeMax needs the owner's age + resolved IRS
 * params, and percent-mode needs the owner's salary slice, and both of those
 * live in the projection, not this page-shaped adapter. (scheduleOverrides is
 * the same class of gap and is tracked separately, not fixed here.)
 *
 * So: contributeMax / percent-of-pay rules show the RULE as the label and
 * contribute a literal `0` to subtotals — a card that shows a rule must not
 * add a dollar figure the engine will overrule. Only the flat-dollar branch
 * (the one case fully resolvable without the projection) contributes a real
 * number, and since savings is an outflow it is negative, exactly like
 * expenseToMapItem's outflows, so `items.reduce((s, i) => s + i.value, 0)`
 * nets out correctly without any kind-specific special-casing by callers.
 */
export function resolveSavings(rule: SavingsRule): { value: number; valueLabel: string } {
  if (rule.contributeMax) return { value: 0, valueLabel: "IRS max" };
  if (rule.annualPercent != null && rule.annualPercent > 0) {
    return { value: 0, valueLabel: `${Math.round(rule.annualPercent * 100)}% of pay` };
  }
  const value = -rule.annualAmount;
  return { value, valueLabel: moneyLabel(value) };
}

export function savingsNoteChip(rule: SavingsRule): string | null {
  if (rule.employerMatchAmount != null) return `${formatCurrency(rule.employerMatchAmount)} match`;
  if (rule.employerMatchPct != null) return `${Math.round(rule.employerMatchPct * 100)}% match`;
  return null;
}

/** A savings rule inherits the column of the account it funds. */
export function savingsToMapItem(
  rule: SavingsRule,
  accountById: ReadonlyMap<string, Account>,
  ctx: ColumnContext,
): MapItem {
  const account = accountById.get(rule.accountId);
  const { value, valueLabel } = resolveSavings(rule);
  return {
    id: rule.id,
    kind: "savings",
    category: "investments",
    name: account?.name ?? "Contribution",
    value,
    valueLabel,
    ...assignColumn(account ?? { owners: [] }, ctx),
    noteChip: savingsNoteChip(rule),
  };
}

/** Expenses are household-level: they land in `joint` unless an entity pays
 *  them. Outflows carry a negative `value` so board subtotals net out. */
export function expenseToMapItem(expense: Expense, ctx: ColumnContext): MapItem {
  const value = -expense.annualAmount;
  const forName = expense.forFamilyMemberId
    ? ctx.nameByFamilyMemberId.get(expense.forFamilyMemberId)
    : undefined;
  return {
    id: expense.id,
    kind: "expense",
    category: expense.type === "insurance" ? "insurance" : "debt",
    name: expense.name,
    value,
    valueLabel: moneyLabel(value),
    ...flowAssignment(expense.ownerEntityId, "joint", ctx),
    noteChip: forName ? `for ${forName}` : null,
  };
}
