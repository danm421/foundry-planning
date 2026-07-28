// src/lib/household-map/account-write.ts
//
// The Map's two write payloads are DELIBERATELY asymmetric. Do not "simplify"
// the scenario one to match the base one.
//
//   Base mode    -> only the changed keys. Safe because the PUT route's update
//                   is truly partial (lib/clients/accounts-writes.ts:412) —
//                   it spreads only the keys present after an identity strip.
//
//   Scenario mode -> the ENTIRE row. `applyEntityEdit` upserts with
//                   `set: { payload: diff }` (lib/scenario/changes-writer.ts:284),
//                   a wholesale replace, and `buildFieldDiff` only emits keys
//                   the caller actually sent. A narrow { value } write against
//                   an account whose growthSource was overridden in that
//                   scenario DELETES the growth override — silently; the number
//                   just reverts to base on the next render.
//
// Making applyEntityEdit merge instead was considered and rejected: replace is
// how reverting a field works (resend it at its base value, it drops out of the
// diff), so merging would break partial reverts app-wide.
import { parseGrowthSourceSelection } from "@/components/forms/growth-rate-field";
import type { AccountRow } from "@/components/balance-sheet-view";

/** The fields the Map's inline editors can change. */
export type AccountPatch = Partial<
  Pick<AccountRow, "value" | "growthRate" | "growthSource" | "modelPortfolioId" | "tickerPortfolioId">
>;

/**
 * View-only or server-owned keys that must never be written back.
 *
 * `owner` (singular, derived client/spouse/joint display label) is stripped.
 * `owners` (plural, the persisted ownership-split relation) is NOT in this
 * set and must pass through untouched — the two are easy to conflate and
 * getting it backwards either silently drops a real ownership split or
 * writes a derived label back as data.
 */
const NON_WRITABLE_KEYS = new Set([
  "id",
  "linkedSource",
  "beneficiaryDisplayName",
  "owner",
]);

export function buildBasePayload(patch: AccountPatch): Record<string, unknown> {
  return { ...patch };
}

export function buildScenarioDesiredFields(
  row: AccountRow,
  patch: AccountPatch,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (NON_WRITABLE_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return { ...out, ...patch };
}

/** Turn a raw `<select>` value into the fields to persist. Reuses the form's
 *  own parser so the two cannot drift. `growthRate` is deliberately absent —
 *  picking "custom" only arms the percent editor; the rate arrives on commit. */
export function patchFromGrowthSelection(raw: string): AccountPatch {
  const { growthSource, modelPortfolioId, tickerPortfolioId } = parseGrowthSourceSelection(raw);
  return { growthSource, modelPortfolioId, tickerPortfolioId };
}
