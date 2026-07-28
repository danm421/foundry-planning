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
  /** Signed long-term capital gains realized by switches this year — negative
   *  when an underwater sleeve was sold and rebought. */
  capitalGains: number;
  byReinvestment: Record<string, { capitalGains: number; label: string }>;
}

/** Apply reinvestment techniques effective in `year`. Mutates each target
 *  account's `growthRate` / `realization` in place — the change persists for
 *  all later years until another reinvestment overrides it. When
 *  `realizeTaxesOnSwitch` is set, also realizes long-term capital gains on
 *  taxable accounts, returning the gain in `capitalGains`.
 *
 *  A taxed switch is value-neutral: it steps up `basisMap` and realizes gain
 *  but does NOT change `accountBalances` or `accountLedgers` — the proceeds are
 *  immediately reinvested. */
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
        // Signed: a sell-and-rebuy of an underwater sleeve realizes a LOSS and
        // steps basis DOWN. No §1091 wash-sale test is applied. This is a TIMING
        // difference, not a permanent overstatement: the basis step-down below
        // (basis = basis + realizedGain) means the model and §1091 converge on the
        // same total gain by the final sale. With B = basis before the switch,
        // V = value at the switch, L = V - B the realized loss, and P = final
        // proceeds: the model recognizes L now and P - V later (total P - B);
        // §1091 disallows L, keeps basis at B, and recognizes P - B later. Both
        // equal P - B, because B + L = V. The loss is simply recognized earlier
        // than §1091 permits (documented limitation, see spec known-gaps).
        const realizedGain = (bal - basis) * fraction;
        if (realizedGain !== 0) {
          input.basisMap[acct.id] = basis + realizedGain;
          capitalGains += realizedGain;
          byReinvestmentGains += realizedGain;
        }
      }

      acct.growthRate = ri.newGrowthRate;
      if (
        (acct.category === "taxable" || acct.category === "cash") &&
        ri.newRealization
      ) {
        // Replace the realization MIX but carry through the account's own
        // turnoverPct — turnover is an account-level property; `ri.newRealization`
        // carries a placeholder 0 the resolver could not know.
        acct.realization = {
          ...ri.newRealization,
          turnoverPct: acct.realization?.turnoverPct ?? 0,
        };
      }
    }
    byReinvestment[ri.id] = { capitalGains: byReinvestmentGains, label: ri.name };
  }

  return { capitalGains, byReinvestment };
}
