import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";

export type BalanceMode = "boy" | "eoy";

/**
 * Returns a copy of `tree` with each account's `value` and each liability's
 * `balance` overridden to the requested year's snapshot, sourced from the
 * projection. Keeps `rowsForFamilyMember` / `rowsForEntity` /
 * `unlinkedLiabilitiesForFamilyMember` (which read `account.value` and
 * `liability.balance` directly) consistent with the spine's net-worth values
 * at the same year.
 *
 * `mode` mirrors the Balance Sheet's two views:
 *   - "boy" (Today) — beginning-of-year balances. At planStartYear these
 *     equal the advisor-entered values, so the original tree is returned
 *     unchanged.
 *   - "eoy" (default) — end-of-year balances for the requested year.
 *
 * "Today · 2026" and "End of 2026" land on the same calendar year but
 * resolve to different snapshots (BoY vs EoY). Callers must pass the
 * intended mode rather than relying on `year` alone.
 *
 * Falls back to the original tree if the requested year isn't in the
 * projection (e.g., past planEndYear).
 */
export function treeAsOfYear(
  tree: ClientData,
  withResult: ProjectionResult,
  year: number,
  mode: BalanceMode = "eoy",
): ClientData {
  const planStartYear = tree.planSettings.planStartYear;
  if (mode === "boy" && year === planStartYear) return tree;

  const yearRow = withResult.years.find((y) => y.year === year);
  if (!yearRow) return tree;

  const accounts = tree.accounts.map((a) => {
    const ledger = yearRow.accountLedgers[a.id];
    if (!ledger) return { ...a, value: 0 };
    const value = mode === "boy" ? ledger.beginningValue : ledger.endingValue;
    if (mode !== "eoy" || a.owners.length <= 1 || value <= 0) {
      return { ...a, value };
    }

    // EoY multi-owner accounts: renormalize percents from the engine's locked
    // shares so household withdrawals don't bleed into the entity's slice
    // (and vice versa). Mirrors balance-sheet/view-model.ts. Consumers that
    // do `account.value × owner.percent` (render-rows.ts:82) then yield the
    // same locked slice the balance sheet shows.
    let totalEntityShare = 0;
    let familyPercentTotal = 0;
    for (const o of a.owners) {
      if (o.kind === "entity") {
        const locked = yearRow.entityAccountSharesEoY?.get(o.entityId)?.get(a.id);
        totalEntityShare += locked ?? value * o.percent;
      } else {
        familyPercentTotal += o.percent;
      }
    }
    const familyPool = Math.max(0, value - totalEntityShare);

    const owners = a.owners.map((o) => {
      let sliceValue: number;
      if (o.kind === "entity") {
        const locked = yearRow.entityAccountSharesEoY?.get(o.entityId)?.get(a.id);
        sliceValue = locked ?? value * o.percent;
      } else {
        const lockedFm = yearRow.familyAccountSharesEoY
          ?.get(o.familyMemberId)
          ?.get(a.id);
        if (lockedFm != null) {
          sliceValue = lockedFm;
        } else {
          sliceValue =
            familyPercentTotal > 0
              ? familyPool * (o.percent / familyPercentTotal)
              : value * o.percent;
        }
      }
      return { ...o, percent: sliceValue / value };
    });

    return { ...a, value, owners };
  });

  const liabilities = (tree.liabilities ?? []).map((l) => {
    if (mode === "boy") {
      const boy = yearRow.liabilityBalancesBoY?.[l.id];
      return boy != null ? { ...l, balance: boy } : l;
    }
    // EoY of year Y = BoY of Y+1 (amortization is continuous between years).
    // Past plan end, fall back to Y's BoY.
    const nextYearRow = withResult.years.find((y) => y.year === year + 1);
    const eoy = nextYearRow?.liabilityBalancesBoY?.[l.id];
    if (eoy != null) return { ...l, balance: eoy };
    const sameYearBoY = yearRow.liabilityBalancesBoY?.[l.id];
    return sameYearBoY != null ? { ...l, balance: sameYearBoY } : l;
  });

  return { ...tree, accounts, liabilities };
}