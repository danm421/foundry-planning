// src/lib/household-map/flow-write.ts
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

/** The only field the Cash Flow board's inline editor changes. */
export interface FlowAmountPatch {
  annualAmount: string;
}

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
 * field set a scenario edit may send. Runs SERVER-side (`map-content.tsx`) so
 * the client never has to know the engine's field list.
 *
 * `undefined` values are dropped: the engine resolvers write `x ?? undefined`
 * for every absent optional column, and an explicit `undefined` in
 * `desiredFields` would diff against a base `null` as a change and write
 * `undefined` over it.
 */
export function buildFlowScenarioFields<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (NON_WRITABLE_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The patch itself. `Math.abs` is not defensive tidying — outflow cards render
 * their amount in accounting parens ("($200,000)") while the input holds the
 * unsigned 200000, so a minus sign is exactly what an advisor reaches for when
 * they mean "this is an expense". `annualAmount` is unsigned on all three
 * tables; a negative would turn an expense into an inflow for the whole
 * projection. Keep the magnitude, drop the sign.
 */
export function flowAmountPatch(next: number): FlowAmountPatch {
  return { annualAmount: String(Math.abs(next)) };
}

/** Scenario payload: the pruned effective row with the new amount on top. */
export function buildFlowScenarioDesiredFields(
  fields: Record<string, unknown>,
  patch: FlowAmountPatch,
): Record<string, unknown> {
  return { ...fields, ...patch };
}
