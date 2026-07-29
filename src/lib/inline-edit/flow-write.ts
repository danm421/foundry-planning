// src/lib/inline-edit/flow-write.ts
//
// Write payloads for the Cash Flow board's inline amount editor. Same
// deliberate asymmetry as `account-write.ts` — do NOT "simplify" the scenario
// payload to match the base one:
//
//   Base mode     -> only the changed key. Safe because all three PUT routes
//                    apply a partial update (`incomes-writes.ts` /
//                    `expenses-writes.ts` spread `p.x !== undefined && {x}`;
//                    the savings-rules route does the same inline).
//
//   Scenario mode -> the whole effective row. `applyEntityEdit` upserts with
//                    `set: { payload: diff }`, a wholesale replace, and
//                    `buildFieldDiff` only emits keys the caller sent. A narrow
//                    `{ annualAmount }` write against an income whose endYear
//                    was overridden in that scenario DELETES the endYear
//                    override — silently. Sending the whole row makes the new
//                    payload "every override this scenario already had, plus the
//                    amount", because the diff is taken against the BASE tree.
//
// The source for that whole row is the EFFECTIVE ENGINE ROW, not the
// `IncomeView` / `ExpenseView` / `SavingsRuleView` the drawer hydrates from.
// Those three are strict subsets of the engine types, and the missing fields are
// ones real producers override: `ExpenseView` has no
// `endsAtMedicareEligibilityOwner`, `SavingsRuleView` no
// `fundFromExpenseReduction` (written by the Solver), `IncomeView` no
// `isSelfEmployment`. Diffing the engine row can't miss a field by construction,
// and can't drift when the engine type gains one.
//
// Making `applyEntityEdit` merge instead was considered and rejected app-wide:
// replace is how reverting a field works (resend it at its base value, it drops
// out of the diff), so merging would break partial reverts everywhere.

import { pruneScenarioFields } from "./scenario-fields";
import type { YearRef } from "@/lib/milestones";

/**
 * The fields the inline flow cells can change.
 *
 * `startYearRef` / `endYearRef` are `YearRef | null` and the null is a REAL
 * value — "manual year, not anchored". Do NOT add a null-strip here mirroring
 * `account-write.ts`'s `growthRate` guard: that guard exists because a null
 * growthRate means ABSENCE and reaches the engine as a literal zero, whereas
 * stripping a null year ref would leave the old anchor in place and make
 * un-anchoring a stream impossible. The rule is per field, never global.
 */
export interface FlowPatch {
  annualAmount?: string;
  owner?: "client" | "spouse" | "joint";
  startYear?: number;
  startYearRef?: YearRef | null;
  endYear?: number;
  endYearRef?: YearRef | null;
  growthRate?: string;
  growthSource?: string;
  modelPortfolioId?: string | null;
  tickerPortfolioId?: string | null;
}

/** Retained so existing call sites keep compiling. */
export type FlowAmountPatch = FlowPatch;

/**
 * Keys stripped from the scenario field set.
 *
 * `id` is identity, never data.
 *
 * `scheduleOverrides` is owned by its OWN targetKinds —
 * `income_schedule_override`, `expense_schedule_override`,
 * `savings_schedule_override` — which are separate `scenario_changes` rows.
 * Copying the effective schedule into the parent row's payload would leave two
 * change rows claiming the same year-by-year amounts, and which one wins then
 * depends on apply order. (Savings rules carrying a schedule aren't inline
 * editable at all — `resolveSavings` gives them `editableAmount: null` — but
 * incomes and expenses with one are, so the strip has to be here.)
 */
const NON_WRITABLE_KEYS: ReadonlySet<string> = new Set(["id", "scheduleOverrides"]);

/**
 * Prune an effective engine income / expense / savings-rule row down to the
 * field set a scenario edit may send — the shared `pruneScenarioFields` rule
 * (which owns the `undefined`-vs-`null` reasoning) plus this module's strip set.
 */
export function buildFlowScenarioFields<T extends object>(row: T): Record<string, unknown> {
  return pruneScenarioFields(row, NON_WRITABLE_KEYS);
}

/**
 * The patch itself. `Math.abs` is not defensive tidying — outflow cards render
 * their amount in accounting parens ("($200,000)") while the input holds the
 * unsigned 200000, so a minus sign is exactly what an advisor reaches for when
 * they mean "this is an expense". `annualAmount` is unsigned on all three
 * tables; a negative would turn an expense into an inflow for the whole
 * projection. Keep the magnitude, drop the sign.
 */
export function flowAmountPatch(next: number): FlowPatch {
  return { annualAmount: String(Math.abs(next)) };
}

/**
 * The year pair for one end of a flow's window. Both keys always travel
 * together: writing `startYear` without `startYearRef` would leave a stale
 * anchor that re-derives the year on the next milestone change, silently
 * undoing the edit.
 */
export function flowYearPatch(
  position: "start" | "end",
  year: number,
  ref: YearRef | null,
): FlowPatch {
  return position === "start"
    ? { startYear: year, startYearRef: ref }
    : { endYear: year, endYearRef: ref };
}

/** Scenario payload: the pruned effective row with the new amount on top. */
export function buildFlowScenarioDesiredFields(
  fields: Record<string, unknown>,
  patch: FlowPatch,
): Record<string, unknown> {
  return { ...fields, ...patch };
}
