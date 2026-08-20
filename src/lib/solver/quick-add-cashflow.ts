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
    ...(kind === "income" ? { owner } : {}),
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
    taxType: "ordinary_income",
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
  return { ...sharedDraftFields(i), kind: "income", owner: i.owner };
}

export function draftFromExpense(e: Expense): CashflowDraft {
  return { ...sharedDraftFields(e), kind: "expense" };
}
