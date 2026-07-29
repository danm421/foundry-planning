// src/lib/household-map/map-items.ts
import { formatCurrency } from "@/lib/cell-drill/format";
import type { Account, Expense, Income, SavingsRule } from "@/engine/types";
import { assignColumn } from "./columns";
import { moneyLabel } from "./format";
import { isSocialSecurityIncome } from "./social-security";
import type {
  ColumnAssignment,
  ColumnContext,
  FlowStartNote,
  FlowTiming,
  MapColumn,
  MapItem,
} from "./types";

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
    // A balance, not a flow: no projection window, and its inline editor lives
    // on the Net Worth board, which writes through `accountRows` instead.
    timing: null,
    editableAmount: null,
  };
}

/**
 * A flow's projection window, for the Cash Flow board's timing column.
 *
 * A straight lift, on purpose: `resolvedStart`/`resolvedEnd` in
 * `lib/projection/load-client-data.ts` already turned any milestone ref into the
 * year the engine projects with, so re-resolving here could only disagree with
 * the projection. The refs are carried through unresolved so the cell can NAME
 * the anchor in its tooltip.
 */
export function flowTiming(
  flow: {
    startYear: number;
    endYear: number;
    startYearRef?: string | null;
    endYearRef?: string | null;
  },
  startsAt: FlowStartNote | null = null,
): FlowTiming {
  return {
    startYear: flow.startYear,
    endYear: flow.endYear,
    startYearRef: flow.startYearRef ?? null,
    endYearRef: flow.endYearRef ?? null,
    startsAt,
  };
}

/**
 * Incomes and expenses have no `owners[]` — ownership is a single enum (income)
 * or implicitly the household (expense), plus at most one non-household owner:
 * an entity (`ownerEntityId`) or a top-level business account
 * (`ownerAccountId`, the business-as-asset model). Both tray, for the same
 * reason `assignColumn` trays an entity-owned asset: the board has no honest
 * way to draw them in a principal's column, and their raw amounts are not
 * household cash.
 *
 * The business-account case matters as much as the entity case. Business-owned
 * rows reach household cash ONLY via the business's distribution sweep
 * (`src/engine/projection.ts` ~:758-788), so drawing $200k of S-corp gross
 * revenue in the Joint column double-counts against the $80k distribution the
 * engine actually reports — and `/details/income-expenses` excludes them from
 * its household totals for exactly this reason
 * (`income-expenses-view.tsx`'s `householdIncome`/`householdExpense`).
 *
 * Entity wins when a row somehow carries both (the engine treats them as
 * mutually exclusive); that mirrors `assignColumn`'s rule-1-first ordering.
 */
export function flowAssignment(
  flow: { ownerEntityId?: string; ownerAccountId?: string },
  householdColumn: MapColumn,
  accountById: ReadonlyMap<string, Pick<Account, "name">>,
  ctx: ColumnContext,
): ColumnAssignment {
  if (flow.ownerEntityId) {
    return {
      column: "tray",
      splitChip: null,
      trayOwnerLabel: ctx.nameByEntityId.get(flow.ownerEntityId) ?? "Entity-owned",
    };
  }
  if (flow.ownerAccountId) {
    return {
      column: "tray",
      splitChip: null,
      trayOwnerLabel: accountById.get(flow.ownerAccountId)?.name ?? "Business-owned",
    };
  }
  return { column: householdColumn, splitChip: null, trayOwnerLabel: null };
}

/**
 * @param startsAt Replaces the card's year range. Only Social Security passes
 *   one — see `ssStartNote` in `./social-security`, which is also where the
 *   reason an SS row's persisted years are meaningless is written down.
 */
export function incomeToMapItem(
  income: Income,
  accountById: ReadonlyMap<string, Pick<Account, "name">>,
  ctx: ColumnContext,
  startsAt: FlowStartNote | null = null,
): MapItem {
  return {
    id: income.id,
    kind: "income",
    category: "investments",
    name: income.name,
    value: income.annualAmount,
    valueLabel: moneyLabel(income.annualAmount),
    ...flowAssignment(income, income.owner, accountById, ctx),
    noteChip: null,
    timing: flowTiming(income, startsAt),
    // NO inline editor on Social Security, even though it now has a pencil.
    // `annualAmount` is not the row's number in `pia_at_fra` mode — the engine
    // computes the benefit from `piaMonthly` + the claim age and ignores the
    // column entirely — so a field over it would accept a figure the projection
    // discards. `SocialSecurityDialog` owns every SS field; see
    // `isHydratableIncome` below for why a narrow write is worse than none here.
    editableAmount: isSocialSecurityIncome(income) ? null : income.annualAmount,
  };
}

/**
 * `value` and `valueLabel` MUST come from the same branch — a card that shows
 * one number while the engine subtotals another is the bug this fixes.
 *
 * Mirrors the engine's own resolution order (engine/projection.ts's
 * resolvedByRuleId loop → engine/savings.ts resolveContributionAmount):
 * scheduleOverrides[year] first, then contributeMax (IRS limit), then
 * percent-of-pay, then flat annualAmount. Only the flat-dollar branch resolves
 * to a NUMBER here — contributeMax needs the owner's age + resolved IRS
 * params, percent-mode needs the owner's salary slice, and a schedule is
 * year-by-year while a card shows one figure; all three live in the
 * projection, not this page-shaped adapter.
 *
 * So: schedule / contributeMax / percent-of-pay rules show the RULE as the
 * label and contribute a literal `0` to subtotals — a card that shows a rule
 * must not add a dollar figure the engine will overrule. Only the flat-dollar
 * branch contributes a real number, and since savings is an outflow it is
 * negative, exactly like expenseToMapItem's outflows, so
 * `items.reduce((s, i) => s + i.value, 0)` nets out correctly without any
 * kind-specific special-casing by callers.
 *
 * `editableAmount` follows the same three-way split, and for the same reason:
 * it is the rule's UNSIGNED `annualAmount` on the flat branch and null on every
 * other, so the Cash Flow board offers a number editor exactly where a number is
 * what the engine will use. Offering one on a "20% of pay" rule would let an
 * advisor type a figure the projection then overrules. See
 * `MapItem.editableAmount`.
 */
export function resolveSavings(rule: SavingsRule): {
  value: number;
  valueLabel: string;
  editableAmount: number | null;
} {
  // FIRST, matching the engine's resolution order: a schedule beats every
  // other mode, so a rule with one must never advertise its flat annualAmount.
  if (rule.scheduleOverrides && Object.keys(rule.scheduleOverrides).length > 0) {
    return { value: 0, valueLabel: "Custom schedule", editableAmount: null };
  }
  if (rule.contributeMax) return { value: 0, valueLabel: "IRS max", editableAmount: null };
  if (rule.annualPercent != null && rule.annualPercent > 0) {
    return {
      value: 0,
      valueLabel: `${Math.round(rule.annualPercent * 100)}% of pay`,
      editableAmount: null,
    };
  }
  const value = -rule.annualAmount;
  return { value, valueLabel: moneyLabel(value), editableAmount: rule.annualAmount };
}

// ──────────────────────────────────────────────────────────────────────────
// Editor hydration eligibility
//
// A hydration entry in `HouseholdMapProps.incomeRows` / `.expenseRows` is what
// makes a card clickable (see `isItemEditable` in household-map-view.tsx). The
// two predicates below decide who gets one. Both exclusions are about writes
// that would DESTROY data, not writes that would merely fail — the excluded
// rows keep their CARD and keep counting toward the band subtotal.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Whether an income may open the Map's quick-edit drawer.
 *
 * 1. `source: "policy"` — `policy-income-<uuid>` rows re-derived from
 *    life-insurance accounts on every load. No DB row exists, so no write path
 *    accepts them (base PUT hits a uuid column and 500s; the scenario changes
 *    route rejects the id at `targetId: z.string().uuid()`).
 *
 * 2. `type: "social_security"` — the drawer submits a FIXED nine-key
 *    `desiredFields` body (`quick-edit-drawer.tsx` handleSave) and the scenario
 *    changes-writer treats that body as a WHOLESALE REPLACE: `buildFieldDiff`
 *    iterates only the keys present, and the result is stored as
 *    `payload: diff` (`lib/scenario/changes-writer.ts`). An SS income carries
 *    five fields the drawer never renders — `claimingAge`, `claimingAgeMonths`,
 *    `claimingAgeMode`, `piaMonthly`, `ssBenefitMode`, all written by
 *    `social-security-dialog.tsx`'s payload — so opening an SS card inside a
 *    "Claim at 70" scenario and pressing Save with NO edits makes every
 *    submitted field equal base, the diff empty, and the whole scenario edit
 *    row is deleted: the scenario silently reverts to claiming at FRA and the
 *    projection, Monte Carlo and solver all move with it.
 *    `income-expenses-view.tsx` (`nonSsIncomeList`) excludes SS from its own
 *    nine-field dialog for exactly this reason.
 *
 * This is a rule about ONE EDITOR, not about editability. SS rows are now fully
 * editable from the Cash Flow board — their pencil opens `SocialSecurityDialog`
 * itself, hydrated from `HouseholdMapProps.ssIncomeRows`, which submits all five
 * of the fields above and so cannot produce the empty diff described. Keeping
 * them out of `incomeRows` is what ROUTES them there: `isItemEditable` in
 * `household-map-view.tsx` checks both maps and `handleEditItem` picks the
 * dialog by which one the id is in. Do not "fix" this predicate by admitting SS.
 */
export function isHydratableIncome(income: Pick<Income, "source" | "type">): boolean {
  return income.source !== "policy" && !isSocialSecurityIncome(income);
}

/** Expense counterpart of `isHydratableIncome`. Only the synthesized
 *  `premium-<uuid>` policy rows are excluded — no expense type carries a field
 *  set the drawer fails to render the way social security does. */
export function isHydratableExpense(expense: Pick<Expense, "source">): boolean {
  return expense.source !== "policy";
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
  const { value, valueLabel, editableAmount } = resolveSavings(rule);
  return {
    id: rule.id,
    kind: "savings",
    category: "investments",
    name: account?.name ?? "Contribution",
    value,
    valueLabel,
    ...assignColumn(account ?? { owners: [] }, ctx),
    noteChip: savingsNoteChip(rule),
    timing: flowTiming(rule),
    editableAmount,
  };
}

/** Expenses are household-level: they land in `joint` unless an entity pays
 *  them. Outflows carry a negative `value` so board subtotals net out. */
export function expenseToMapItem(
  expense: Expense,
  accountById: ReadonlyMap<string, Pick<Account, "name">>,
  ctx: ColumnContext,
): MapItem {
  const value = -expense.annualAmount;
  const forName = expense.forFamilyMemberId
    ? ctx.nameByFamilyMemberId.get(expense.forFamilyMemberId)
    : undefined;
  return {
    id: expense.id,
    kind: "expense",
    // NOT "debt" — that hue is `--color-crit`, the app's error red, and an
    // ordinary groceries or rent card should not read as an alert. Only
    // liabilities are debt.
    category: expense.type === "insurance" ? "insurance" : "household",
    name: expense.name,
    value,
    valueLabel: moneyLabel(value),
    ...flowAssignment(expense, "joint", accountById, ctx),
    noteChip: forName ? `for ${forName}` : null,
    timing: flowTiming(expense),
    // The UNSIGNED column value, not `value` above — see MapItem.editableAmount.
    editableAmount: expense.annualAmount,
  };
}
