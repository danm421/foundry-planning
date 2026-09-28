import type { Account, ProjectionYear } from "@/engine/types";
import { giftValueOfAccount } from "@/engine/business/business-tree";

/**
 * Resolves an account's projected balance at a projection year, or undefined
 * when the projection holds no row for that year / no ledger for that account
 * (a gift dated before `planStartYear`, or a pre-activation account).
 *
 * Callers that must produce a number treat undefined as 0 — that is what the
 * engine does. Callers showing the figure to an advisor should keep the
 * distinction, so they can say whether the number is projected or a fallback.
 */
export type AccountValueAtYear = (
  accountId: string,
  year: number,
) => number | undefined;

/**
 * Build the account-balance resolver the engine values an in-kind gift with.
 *
 * `runProjectionWithEvents` values a gift from the gift year's
 * `accountLedgers[*].endingValue` through `giftValueOfAccount` — a top-level
 * business at its consolidated value (parent plus every account under it) —
 * so every surface that previews, reports on, or sizes an asset gift has to
 * read the same way or it will quote a different number than the exemption
 * the gift actually consumes. This factory exists so that read is written once.
 *
 * `accounts` is the account list the projection ran on (`ClientData.accounts`).
 */
export function buildAccountValueAtYear(
  years: ProjectionYear[],
  accounts: Account[],
): AccountValueAtYear {
  const yearByYear = new Map(years.map((y) => [y.year, y]));
  return (accountId, year) => {
    const ledgers = yearByYear.get(year)?.accountLedgers;
    if (ledgers?.[accountId] == null) return undefined;
    const balances: Record<string, number> = {};
    for (const [id, ledger] of Object.entries(ledgers)) balances[id] = ledger.endingValue;
    return giftValueOfAccount(accountId, accounts, balances);
  };
}
