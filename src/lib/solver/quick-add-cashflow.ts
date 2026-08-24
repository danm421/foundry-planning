// src/lib/solver/quick-add-cashflow.ts
//
// Pure row builders for the solver's "+ Add income or expense" popup — the
// income/expense counterpart to quick-add-account.ts. Framework-free so the
// shapes the popup mints are unit-testable without going through the DOM.
//
// One row shape only: a plain household stream. Entity / business /
// linked-property ownership and the non-"other" income types stay with the full
// editors in Details — this popup exists to model a stream inside a solve, not
// to replace them.

import type { Income, Expense } from "@/engine/types";
import type { IncomeTaxType, SolverMutation } from "./types";
import {
  defaultIncomeRefs,
  defaultExpenseRefs,
  resolveMilestone,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";

export type CashflowKind = "income" | "expense";
export type CashflowOwner = "client" | "spouse" | "joint";

/** The engine `type` every quick-added row carries, for both incomes and
 *  expenses. Deliberately NOT "living" for an expense: isRetirementLivingExpense
 *  sweeps any living row beginning after plan start into the
 *  `living-expense-scale` solve lever, so a "living" default would hand the
 *  solver a row the advisor just typed and let it scale that too. */
export const QUICK_ADD_CASHFLOW_TYPE = "other";

/** Tax treatment a fresh income row starts on. Same neutral default the full
 *  income editor falls back to for an "other" stream. */
export const DEFAULT_INCOME_TAX_TYPE: IncomeTaxType = "ordinary_income";

/** True for a row this popup could have minted. The added-rows list filters on
 *  it so a synthesized retirement living expense (living-expense.ts) or an
 *  education goal (solver-education-section.tsx) — both of which also reach the
 *  working tree via `expense-upsert` — never show up here with a delete button. */
export function isQuickAddCashflowRow(row: { type: string }): boolean {
  return row.type === QUICK_ADD_CASHFLOW_TYPE;
}

export interface CashflowDraft {
  kind: CashflowKind;
  id: string;
  name: string;
  annualAmount: number;
  /** Income only — an Expense has no household owner anywhere in the app
   *  (only ownerEntityId / ownerAccountId). Absent on an expense draft. */
  owner?: CashflowOwner;
  /** Income only — how the engine taxes the stream. Absent on an expense draft. */
  taxType?: IncomeTaxType;
  growthSource: "custom" | "inflation";
  growthRate: number;
  startYear: number;
  startYearRef: YearRef | null;
  endYear: number;
  endYearRef: YearRef | null;
}

/** A fresh row, defaulted the way every other add-income/add-expense surface in
 *  the app defaults one: milestone-anchored year refs from `defaultIncomeRefs` /
 *  `defaultExpenseRefs`, and growth tracking plan inflation. */
export function blankCashflowDraft(opts: {
  kind: CashflowKind;
  id: string;
  owner: CashflowOwner;
  milestones: ClientMilestones;
  inflationRate: number;
}): CashflowDraft {
  const { kind, id, owner, milestones, inflationRate } = opts;
  const refs =
    kind === "income"
      ? defaultIncomeRefs(QUICK_ADD_CASHFLOW_TYPE, owner)
      : defaultExpenseRefs(QUICK_ADD_CASHFLOW_TYPE);
  return {
    kind,
    id,
    name: "",
    annualAmount: 0,
    ...(kind === "income" ? { owner, taxType: DEFAULT_INCOME_TAX_TYPE } : {}),
    growthSource: "inflation",
    growthRate: inflationRate,
    startYear: yearFor(refs.startYearRef, milestones, "start", milestones.planStart),
    startYearRef: refs.startYearRef,
    endYear: yearFor(refs.endYearRef, milestones, "end", milestones.planEnd),
    endYearRef: refs.endYearRef,
  };
}

/** Concrete year behind a default ref. `applyMutations` re-runs `resolveRefYears`
 *  over the whole tree anyway, so this only has to be right for what the picker
 *  shows before the first edit. */
function yearFor(
  ref: YearRef | null,
  milestones: ClientMilestones,
  position: "start" | "end",
  fallback: number,
): number {
  if (!ref) return fallback;
  return resolveMilestone(ref, milestones, position) ?? fallback;
}

/** Fields both row kinds carry identically. Keeping them in one place is what
 *  stops a new shared field from being added to three of the four mappers. */
function sharedRowFields(d: CashflowDraft) {
  return {
    id: d.id,
    type: QUICK_ADD_CASHFLOW_TYPE,
    name: d.name,
    annualAmount: d.annualAmount,
    startYear: d.startYear,
    endYear: d.endYear,
    growthRate: d.growthRate,
    growthSource: d.growthSource,
    startYearRef: d.startYearRef,
    endYearRef: d.endYearRef,
    source: "manual",
  } as const;
}

export function incomeFromDraft(d: CashflowDraft): Income {
  return {
    ...sharedRowFields(d),
    owner: d.owner ?? "client",
    taxType: d.taxType ?? DEFAULT_INCOME_TAX_TYPE,
  };
}

export function expenseFromDraft(d: CashflowDraft): Expense {
  return sharedRowFields(d);
}

function sharedDraftFields(row: Income | Expense) {
  return {
    id: row.id,
    name: row.name,
    annualAmount: row.annualAmount,
    growthSource: (row.growthSource === "inflation" ? "inflation" : "custom") as
      | "custom"
      | "inflation",
    growthRate: row.growthRate,
    startYear: row.startYear,
    startYearRef: (row.startYearRef ?? null) as YearRef | null,
    endYear: row.endYear,
    endYearRef: (row.endYearRef ?? null) as YearRef | null,
  };
}

export function draftFromIncome(i: Income): CashflowDraft {
  return {
    ...sharedDraftFields(i),
    kind: "income",
    owner: i.owner,
    taxType: (i.taxType as IncomeTaxType | undefined) ?? DEFAULT_INCOME_TAX_TYPE,
  };
}

export function draftFromExpense(e: Expense): CashflowDraft {
  return { ...sharedDraftFields(e), kind: "expense" };
}

/** The rows this session added: present in the working tree, absent from the
 *  tree the solver started from, and of the type this popup mints.
 *
 *  Compared against the SOURCE rather than base so a loaded scenario's own rows
 *  are never offered up for deletion, and type-filtered so a synthesized
 *  retirement living expense (living-expense.ts) or an education goal
 *  (solver-education-section.tsx) — both of which reach the working tree through
 *  the same expense-upsert — are never mistaken for one of ours. A tree diff
 *  says WHAT changed, never WHO changed it. */
export function addedQuickAddRows<T extends { id: string; type: string }>(
  sourceRows: readonly T[],
  workingRows: readonly T[],
): T[] {
  const sourceIds = new Set(sourceRows.map((r) => r.id));
  return workingRows.filter((r) => !sourceIds.has(r.id) && isQuickAddCashflowRow(r));
}

/** The mutation a quick-add row commits with — always a FULL upsert, never a
 *  field lever. Field levers (`income-annual-amount` and friends) are dropped by
 *  save-to-base's source-membership guard for a row base has never seen. */
export function cashflowUpsertMutation(draft: CashflowDraft): SolverMutation {
  return draft.kind === "income"
    ? { kind: "income-upsert", id: draft.id, value: incomeFromDraft(draft) }
    : { kind: "expense-upsert", id: draft.id, value: expenseFromDraft(draft) };
}

/** Drops a quick-added row from the working tree. */
export function cashflowRemoveMutation(kind: CashflowKind, id: string): SolverMutation {
  return kind === "income"
    ? { kind: "income-upsert", id, value: null }
    : { kind: "expense-upsert", id, value: null };
}
