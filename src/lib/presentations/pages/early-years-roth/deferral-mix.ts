// Which accounts a "make it all Roth" instruction can actually move.

import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { deferralAccounts } from "../early-years-standing/deferral-rules";

/**
 * Every 401(k)/403(b) account the plan defers into in its first year.
 *
 * The subtype filter is not cosmetic: `rothPercent` feeds the account's Roth
 * basis only for those two subtypes (`src/engine/projection.ts`, the
 * `rothByAccount` loop). Writing it onto an IRA or a taxable account changes
 * nothing, and a page built on that would print two identical columns under two
 * different headings.
 */
export function rothDeferralAccountIds(data: ClientData): string[] {
  const subTypeById = new Map((data.accounts ?? []).map((a) => [a.id, a.subType]));
  return deferralAccounts(data, data.planSettings.planStartYear)
    .map((a) => a.accountId)
    .filter((id) => subTypeById.get(id) === "401k" || subTypeById.get(id) === "403b");
}

/**
 * Set every eligible deferral to one mix.
 *
 * `applyMutations` writes `savings-roth-percent` onto EVERY rule sharing the
 * account id — which is exactly what "all traditional" and "all Roth" mean, so
 * the usual multi-rule caveat does not apply here.
 */
export function rothMixMutations(data: ClientData, rothPercent: number): SolverMutation[] {
  return rothDeferralAccountIds(data).map((accountId) => ({
    kind: "savings-roth-percent",
    accountId,
    rothPercent,
  }));
}
