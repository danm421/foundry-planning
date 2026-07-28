// src/lib/household-map/account-write.ts
//
// The Map's two write payloads are DELIBERATELY asymmetric. Do not "simplify"
// the scenario one to match the base one.
//
//   Base mode    -> only the changed keys. Safe because the PUT route's
//                   partial account update (`accounts-writes.ts`) spreads
//                   only the keys present after an identity strip.
//
//   Scenario mode -> the entire *view* row (`AccountRow`) — see CAVEAT below,
//                   this is NOT the entire persisted account. `applyEntityEdit`
//                   upserts via `onConflictDoUpdate` with `set: { payload: diff }`,
//                   a wholesale replace, and `buildFieldDiff` only emits keys
//                   the caller actually sent. A narrow { value } write against
//                   an account whose growthSource was overridden in that
//                   scenario DELETES the growth override — silently; the number
//                   just reverts to base on the next render. Sending the whole
//                   view row is what prevents that.
//
//   CAVEAT — `AccountRow` is a strict SUBSET of the persisted account. Three
//   other producers write scenario overrides for `targetKind: "account"`
//   using fields this view row does not carry:
//     - `beneficiaries-tab.tsx`      -> desiredFields: { beneficiaries: refs }
//     - `business-flows-tab.tsx`    -> desiredFields: { flowMode: next }
//     - `add-account-form.tsx`'s wide `accountBody`, which also carries
//       `activationYear`, `activationYearRef`, `revocableTrustName`,
//       `businessType`, `distributionPolicyPercent`, `businessTaxTreatment`,
//       `custodian`, `accountNumberLast4`, `deriveFromHoldings`.
//   None of those fields exist on `AccountRow`, so `buildScenarioDesiredFields`
//   cannot emit them. A Map inline VALUE edit on an account that also carries
//   one of those scenario overrides will STILL silently clobber it — the same
//   failure mode this module exists to prevent, just at a layer this view
//   can't see into. Widening hydration to close this gap is a product
//   decision and is not made by this module.
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
const NON_WRITABLE_KEYS = new Set<keyof AccountRow>([
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
  // `Object.keys` widens to `string[]` even for a known-shaped object, so the
  // loop key needs one assertion back to `keyof AccountRow` — that's what
  // makes `NON_WRITABLE_KEYS.has(k)` typecheck against the real key union
  // below. The safety this buys (a renamed AccountRow field breaking the
  // build) lives in the Set's own `keyof AccountRow` annotation, which this
  // assertion does not touch.
  for (const k of Object.keys(row) as Array<keyof AccountRow>) {
    if (NON_WRITABLE_KEYS.has(k)) continue;
    const v = row[k];
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
