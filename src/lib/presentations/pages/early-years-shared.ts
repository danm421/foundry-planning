// Shared levers for the Your Early Years deck: which deferral account a "save
// more" instruction acts on, and how to add a WINDOWED increase to it without
// rewriting the rule that is already there.
//
// Pure. The only engine reach-through is the leaf `ownership.ts` that
// `deferral-rules.ts` already allows itself — the registry reaches this file
// from "use client" launcher components, so a value import of the projection
// would drag the engine into the browser bundle.

import type { ClientData, SavingsRule } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import {
  deferralAccounts,
  householdSalary,
  isMovable,
  type DeferralAccount,
} from "./early-years-standing/deferral-rules";

/**
 * The one deferral account every Early Years lever acts on: the movable account
 * holding the most DOLLARS.
 *
 * "Largest" in dollars, not in percent: each percent is measured against its own
 * owner's pay, so 10% of a $160k salary is a smaller contribution than 6% of a
 * $345k one. Null when the plan has nothing this deck can move — the caller
 * renders its empty state, or omits itself, rather than comparing a plan with
 * itself.
 */
export function largestMovableDeferral(
  data: ClientData,
  year: number,
): DeferralAccount | null {
  const movable = deferralAccounts(data, year).filter(isMovable);
  if (movable.length === 0) return null;
  const dollars = (a: DeferralAccount) => a.currentPercent * a.ownerSalary;
  return movable.reduce((best, a) => (dollars(a) > dollars(best) ? a : best));
}

/** How much a delta rule adds each year. */
export type DeltaAmount =
  /** A share of HOUSEHOLD salary — the quantity every Early Years sheet prints.
   *  Re-based onto the account owner's own pay before it is written, and
   *  expressed in the mode that account's rule already uses. */
  | { mode: "household-percent"; percent: number }
  /** A fixed number of dollars a year. NEVER converted to a percent: "an extra
   *  $500 a month" is not an instruction that grows with pay. */
  | { mode: "annual-dollars"; annualAmount: number };

export interface DeltaRuleSpec {
  /** Page-local key. Becomes part of the new rule's id, so two pages' variants
   *  can never collide inside one derived tree. */
  key: string;
  amount: DeltaAmount;
  /** First year the increase funds. */
  startYear: number;
  /** Inclusive last year. Defaults to the end of the rule already on the
   *  account — the increase stops when the client stops deferring. */
  endYear?: number;
}

/**
 * ONE `savings-rule-upsert` adding a SECOND savings rule to the deferral
 * account, over a window.
 *
 * Adding a rule rather than rewriting the existing one is what lets a page say
 * "their current rate until 2031, then more" — no other mutation expresses a
 * windowed increase. Three consequences worth knowing:
 *
 * - The base rule is never touched, so this path cannot reintroduce the
 *   flat-dollar indexation defect `ladderMutations` had to be fixed for.
 * - `applyContributionLimits` (`src/engine/contribution-limits.ts`) AGGREGATES
 *   per owner + group across rules and scales each one down proportionally, so
 *   a second rule on one account is still capped correctly.
 * - Every employer-match field is ZEROED. `computeEmployerMatch`
 *   (`src/engine/savings.ts:37`) runs PER RULE off salary and never reads the
 *   deferral rate, so a cloned match would deposit the employer's dollars a
 *   second time and every bar on the sheet would be wrong the same way.
 *
 * `growthRate` is deliberately NOT cloned. It grows an `annualAmount` year over
 * year; a delta is the instruction the advisor typed ("+3 points", "$500 a
 * month"), and inheriting a growth rate from an unrelated rule would quietly
 * index a figure that is meant to be fixed. In percent mode the delta already
 * tracks pay through the percent itself.
 */
export function deltaSavingsRuleMutation(
  source: ClientData,
  spec: DeltaRuleSpec,
): SolverMutation[] {
  const year = source.planSettings.planStartYear;
  const target = largestMovableDeferral(source, year);
  if (target == null) return [];

  // `isMovable` guarantees exactly one rule active in `year` on this account.
  const existing = (source.savingsRules ?? []).find(
    (r) => r.accountId === target.accountId && r.startYear <= year && r.endYear >= year,
  );
  if (existing == null) return [];

  const endYear = spec.endYear ?? existing.endYear;
  if (endYear < spec.startYear) return [];

  const value: SavingsRule = {
    id: `early-years-delta:${spec.key}`,
    accountId: target.accountId,
    annualAmount: 0,
    annualPercent: null,
    isDeductible: existing.isDeductible,
    rothPercent: existing.rothPercent ?? null,
    applyContributionLimit: existing.applyContributionLimit,
    startYear: spec.startYear,
    endYear,
  };

  if (spec.amount.mode === "annual-dollars") {
    value.annualAmount = spec.amount.annualAmount;
  } else if (target.isPercentMode) {
    // The same re-basing `ladderMutations` does: a +3pp share of HOUSEHOLD pay
    // is a larger share of one earner's own pay.
    value.annualPercent =
      (spec.amount.percent * householdSalary(source, year)) / target.ownerSalary;
  } else {
    value.annualAmount = spec.amount.percent * householdSalary(source, year);
  }

  return [{ kind: "savings-rule-upsert", id: value.id, value }];
}

/**
 * The subtitle line every Your Early Years sheet prints under its title.
 *
 * One home for it because five pages print it identically, and the deck's whole
 * claim is that its figures are comparable — a sheet whose subtitle drifted out
 * of step with the others would quietly say it measures something else.
 *
 * The Where You Stand sheet is deliberately NOT a caller: its subtitle carries
 * an extra "At age N" segment, so it is a different sentence that happens to
 * end the same way.
 */
export function earlyYearsSubtitle(scenarioLabel: string | undefined): string {
  return `${scenarioLabel ?? "Base Case"} · Every figure in today's dollars`;
}
