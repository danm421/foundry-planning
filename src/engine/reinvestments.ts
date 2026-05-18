import type { Account, AccountLedger, Reinvestment } from "./types";

export interface ReinvestmentsInput {
  reinvestments: Reinvestment[];
  /** workingAccounts — mutated in place. */
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  accountLedgers: Record<string, AccountLedger>;
  year: number;
}

export interface ReinvestmentsResult {
  /** Long-term capital gains realized by switches this year (Phase 2). */
  capitalGains: number;
  byReinvestment: Record<string, { capitalGains: number; label: string }>;
}

/** Apply reinvestment techniques effective in `year`. Mutates each target
 *  account's `growthRate` / `realization` in place — the change persists for
 *  all later years until another reinvestment overrides it. Phase 1 performs
 *  only the profile switch; the capital-gains branch is added in Phase 2. */
export function applyReinvestments(input: ReinvestmentsInput): ReinvestmentsResult {
  const { reinvestments, accounts, year } = input;
  let capitalGains = 0;
  const byReinvestment: ReinvestmentsResult["byReinvestment"] = {};

  for (const ri of reinvestments) {
    if (ri.year !== year) continue;
    let byReinvestmentGains = 0;
    for (const accountId of ri.accountIds) {
      const acct = accounts.find((a) => a.id === accountId);
      if (!acct) continue; // account removed earlier this projection (sold, etc.)

      if (ri.realizeTaxesOnSwitch && acct.category === "taxable") {
        const bal = input.accountBalances[acct.id] ?? 0;
        const basis = input.basisMap[acct.id] ?? 0;
        const fraction = ri.soldFractionByAccount[acct.id] ?? 0;
        const realizedGain = Math.max(0, bal - basis) * fraction;
        if (realizedGain > 0) {
          input.basisMap[acct.id] = basis + realizedGain; // sell-and-rebuy step-up
          capitalGains += realizedGain;
          byReinvestmentGains += realizedGain;
        }
      }

      acct.growthRate = ri.newGrowthRate;
      if (
        (acct.category === "taxable" || acct.category === "cash") &&
        ri.newRealization
      ) {
        acct.realization = ri.newRealization;
      }
    }
    byReinvestment[ri.id] = { capitalGains: byReinvestmentGains, label: ri.name };
  }

  return { capitalGains, byReinvestment };
}
