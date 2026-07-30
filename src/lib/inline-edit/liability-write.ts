// src/lib/inline-edit/liability-write.ts
//
// Write payloads for the Net Worth page's inline liability cells. Same
// deliberate asymmetry as `account-write.ts` and `flow-write.ts` — do NOT
// "simplify" the scenario payload to match the base one:
//
//   Base mode     -> only the changed keys. Safe because the liabilities PUT
//                    route applies a partial update.
//
//   Scenario mode -> the whole view row. `applyEntityEdit` upserts with
//                    `set: { payload: diff }`, a wholesale replace, and
//                    `buildFieldDiff` only emits keys the caller sent. A narrow
//                    `{ balance }` write against a liability whose interest
//                    rate was overridden in that scenario DELETES that
//                    override — silently.
//
// No `growthRate`-style null exception applies here: liabilities carry no
// derived-null field. `pruneScenarioFields` drops `undefined` and preserves
// `null`, which is the correct rule for every column on this row.
import { pruneScenarioFields } from "./scenario-fields";
import type { LiabilityRow } from "@/components/balance-sheet-view";

/** The fields the Net Worth page's inline liability cells can change. */
export type LiabilityPatch = Partial<
  Pick<LiabilityRow, "balance" | "interestRate" | "owners">
>;

/**
 * View-only or server-owned keys that must never be written back.
 *
 * `ownerEntityId` is DERIVED — `net-worth-content.tsx` computes it as
 * `controllingEntity(l)`. It exists on neither the engine liability nor its
 * meta row, so no reader on either side of a scenario write consumes it; it
 * would only ever diff as `{from: undefined, to: …}` and bloat the payload.
 * Same reasoning as the identically-named key in `account-write.ts`.
 *
 * `owners` (plural, the persisted ownership relation) is NOT in this set and
 * must pass through untouched.
 */
const NON_WRITABLE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "linkedSource",
  "ownerEntityId",
]);

export function buildLiabilityBasePayload(patch: LiabilityPatch): Record<string, unknown> {
  return { ...patch };
}

export function buildLiabilityScenarioDesiredFields(
  row: LiabilityRow,
  patch: LiabilityPatch,
): Record<string, unknown> {
  return { ...pruneScenarioFields(row, NON_WRITABLE_KEYS), ...patch };
}
