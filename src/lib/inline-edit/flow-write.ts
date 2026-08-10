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
  /**
   * Flows store growth source via `itemGrowthSourceEnum` (schema.ts:478-481),
   * which is `["custom", "inflation"]` ONLY — there is no `model_portfolio` /
   * `ticker_portfolio` value for incomes/expenses/savings rules, unlike the
   * account-level `growthSourceEnum` (schema.ts:429-437), which has both. Do
   * not widen this back to `string` or re-add `modelPortfolioId` /
   * `tickerPortfolioId` below — that's the account quartet, and flows have no
   * matching column to write it to.
   */
  growthSource?: "custom" | "inflation";
  /**
   * Social Security's OTHER amount column — the monthly PIA off an SSA
   * statement, from which `resolveAnnualBenefit` derives the benefit. Incomes
   * only; expenses and savings rules have no such column, and nothing outside
   * `ssBenefitPatch` sets it.
   */
  piaMonthly?: string;
  /**
   * Social Security's claim age, as its THREE persisted columns. They always
   * travel together and nothing but `ssClaimAgePatch` sets any of them — see the
   * reasoning there for why writing `claimingAge` on its own is a no-op on two
   * of the three modes.
   *
   * `claimingAgeMode` is typed to the single literal `"years"`, not the column's
   * full `"years" | "fra" | "at_retirement"` enum, deliberately: an inline edit
   * can only ever convert a row TO an explicit age. Switching a row back onto a
   * DERIVED mode is a different act — it discards the stored age rather than
   * setting one — and belongs in `SocialSecurityDialog`, which owns the radio
   * group. Widening this would make that a one-character mistake here.
   */
  claimingAge?: number;
  claimingAgeMonths?: number;
  claimingAgeMode?: "years";
}

/**
 * The claim ages `SocialSecurityDialog`'s own year picker offers, and the range
 * SSA permits: earliest 62, and nothing accrues past 70.
 */
const CLAIM_AGE_MIN_MONTHS = 62 * 12;
const CLAIM_AGE_MAX_MONTHS = 70 * 12;

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
 * The patch for an inline SOCIAL SECURITY benefit edit, keyed off the row's
 * benefit mode.
 *
 * Which column an SS benefit lives in is the one write rule on the Household Map
 * that varies by row, and getting it wrong fails silently: `manual_amount` rows
 * are paid off `annualAmount`, while `pia_at_fra` rows are paid off `piaMonthly`
 * through `resolveAnnualBenefit` and carry `annualAmount` only as dead data the
 * SS dialog forwards. A write to the other column returns 200 and moves nothing
 * in the projection.
 *
 * Same `Math.abs` rule as `flowAmountPatch`, for the same reason: both columns
 * are unsigned, so a stray minus would otherwise be persisted.
 *
 * `no_benefit` is absent by construction — `buildMapGoals` gives those rows no
 * card, so there is nothing to edit.
 */
export function ssBenefitPatch(
  mode: "manual_amount" | "pia_at_fra",
  next: number,
): FlowPatch {
  const value = String(Math.abs(next));
  return mode === "pia_at_fra" ? { piaMonthly: value } : { annualAmount: value };
}

/**
 * The patch for an inline SOCIAL SECURITY CLAIM AGE edit, from an age in YEARS
 * that may carry a fractional part (67.5 = 67y 6mo).
 *
 * ── Why this converts the row's MODE ──────────────────────────────────────────
 *
 * The claim age is three columns behind `resolveClaimAgeMonths`, and two of its
 * three modes never read the column a naive patch would write:
 *
 *   claimingAgeMode "fra"           -> derived from DOB via `fraForBirthDate`
 *   claimingAgeMode "at_retirement" -> `client.retirementAge` / `spouseRetirementAge`
 *   claimingAgeMode "years" | NULL  -> `claimingAge * 12 + (claimingAgeMonths ?? 0)`
 *
 * So `{ claimingAge: 70 }` against an `fra` row returns 200 and moves nothing —
 * the same silent-failure class as writing `annualAmount` on a `pia_at_fra` row,
 * which is why `ssBenefitPatch` exists.
 *
 * A typed age is therefore treated as an EXPLICIT CHOICE: the patch sets
 * `claimingAgeMode: "years"` together with the two value columns, converting the
 * row off `fra` / `at_retirement`. The alternative readings were both worse. Not
 * writing the mode makes a third of production rows silently ignore the edit.
 * Refusing to edit derived-mode rows at all makes a card's editability depend on
 * an invisible column, and the advisor's remedy — open the dialog, pick "Specific
 * Age", set it — is exactly this conversion in three more clicks.
 *
 * The tradeoff, stated: a converted row stops tracking future DOB / retirement-age
 * changes. That is what choosing an age means, and the Goals card names the
 * derived mode in read mode ("age 67 (FRA)") so the choice is not made blind.
 *
 * ── Why one field and not two ─────────────────────────────────────────────────
 *
 * The whole age lives in ONE number, fractional part included, so a stored 6mo
 * cannot be silently zeroed by a years-only editor. `claimingAgeMonths` is 0 on
 * every Social Security row in production and only `SocialSecurityDialog`'s
 * months select can set it — but "unused" is not "safe to destroy", and a second
 * inline field on a 10px card detail line costs more than the split arithmetic.
 *
 * The clamp is the same posture as `flowAmountPatch`'s `Math.abs`: coerce a typed
 * value into the domain rather than persist one the projection would honour.
 * It is applied to the TOTAL months, so 70y 6mo lands on the ceiling rather than
 * keeping an in-range year part. Production already holds a row with
 * `claimingAge: 53`, so out-of-range ages are real rather than theoretical.
 */
export function ssClaimAgePatch(nextYears: number): FlowPatch {
  const months = Math.min(
    Math.max(Math.round(nextYears * 12), CLAIM_AGE_MIN_MONTHS),
    CLAIM_AGE_MAX_MONTHS,
  );
  return {
    claimingAge: Math.floor(months / 12),
    claimingAgeMonths: months % 12,
    claimingAgeMode: "years",
  };
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

/** Scenario payload: the pruned effective row with the patch merged on top. */
export function buildFlowScenarioDesiredFields(
  fields: Record<string, unknown>,
  patch: FlowPatch,
): Record<string, unknown> {
  return { ...fields, ...patch };
}
