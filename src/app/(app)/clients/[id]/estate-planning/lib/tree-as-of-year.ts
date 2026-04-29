import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";

/**
 * Returns a copy of `tree` with each account's `value` and each liability's
 * `balance` overridden to its end-of-year balance at `year`, sourced from the
 * projection. This keeps `rowsForFamilyMember` / `rowsForEntity` /
 * `unlinkedLiabilitiesForFamilyMember` (which read `account.value` and
 * `liability.balance` directly) consistent with the spine's net-worth values
 * at the same year.
 *
 * For a year ≤ planStartYear, returns the original tree unchanged — the static
 * `account.value` and `liability.balance` are already the BoY-of-plan-start
 * snapshot.
 *
 * Rules:
 *   - account.value at EoY Y = ledger.endingValue from the year row Y
 *     (0 if the account doesn't exist in that year — e.g. sold or transferred)
 *   - liability.balance at EoY Y = Y+1's BoY balance (which equals Y's EoY by
 *     construction); if Y+1 is past planEndYear, falls back to Y's BoY.
 */
export function treeAsOfYear(
  tree: ClientData,
  withResult: ProjectionResult,
  year: number,
): ClientData {
  const planStartYear = tree.planSettings.planStartYear;
  if (year <= planStartYear) return tree;

  const yearRow = withResult.years.find((y) => y.year === year);
  if (!yearRow) return tree;

  const accounts = tree.accounts.map((a) => {
    const ledger = yearRow.accountLedgers[a.id];
    if (!ledger) return { ...a, value: 0 };
    return { ...a, value: ledger.endingValue };
  });

  const nextYearRow = withResult.years.find((y) => y.year === year + 1);
  const liabilities = (tree.liabilities ?? []).map((l) => {
    const eoyBalance = nextYearRow?.liabilityBalancesBoY?.[l.id];
    if (eoyBalance != null) return { ...l, balance: eoyBalance };
    const sameYearBoY = yearRow.liabilityBalancesBoY?.[l.id];
    if (sameYearBoY != null) return { ...l, balance: sameYearBoY };
    return l;
  });

  return { ...tree, accounts, liabilities };
}