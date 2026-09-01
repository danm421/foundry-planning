// src/lib/retirement/retirement-funding.ts
//
// Lifetime funding decomposition for the Retirement Summary report. Splits each
// retirement year's cash toward expenses into Social Security, other income,
// RMDs, and supplemental withdrawals (by tax bucket), then sums retirement→EOL.
//
// Each source is capped at what it actually paid for: a forced RMD larger than
// the year's expenses gets reinvested, not spent, so counting it in full made
// the funding bar total more than the retirement it funds. The surplus is
// reported separately. Invariant: the seven sources sum to `totalFunded`, and
// `totalFunded + shortfall === totalSpending`.
//
// Withdrawal bucketing: the engine does not expose the designated-Roth slice
// inside a 401k/403b draw, so those accounts count fully as pre-tax. Roth =
// roth_ira accounts only.
import type { Account, ProjectionYear } from "@/engine/types";
import { otherInflows, rmdTotal } from "@/lib/retirement/retirement-inflows";

export type WithdrawalTaxBucket = "cash" | "taxable" | "preTax" | "roth";

const ROTH_SUBTYPES = new Set(["roth_ira"]);
const PRETAX_SUBTYPES = new Set(["traditional_ira", "401k", "403b"]);

export function accountTaxBucket(account: Account): WithdrawalTaxBucket {
  if (account.category === "retirement") {
    if (ROTH_SUBTYPES.has(account.subType)) return "roth";
    if (PRETAX_SUBTYPES.has(account.subType)) return "preTax";
    return "preTax"; // other retirement subtypes (e.g. trust) — treat as pre-tax
  }
  if (account.category === "cash") return "cash";
  // taxable, real_estate, business, life_insurance, notes_receivable → taxable
  return "taxable";
}

export interface FundingBreakdown {
  socialSecurity: number;
  otherIncome: number;
  rmds: number;
  withdrawalsCash: number;
  withdrawalsTaxable: number;
  withdrawalsPreTax: number;
  withdrawalsRoth: number;
  /** Unmet expense after all inflows, summed; always >= 0. */
  shortfall: number;
  /** Sum of totalExpenses across retirement years. */
  totalSpending: number;
  /** Everything the sources actually funded. Equals totalSpending - shortfall. */
  totalFunded: number;
  /** Inflow that arrived but was not needed to meet the year's expenses —
   *  mostly forced RMDs, which the engine sweeps back into the portfolio. */
  reinvestedSurplus: number;
}

export function lifetimeFunding(
  years: ProjectionYear[],
  accounts: readonly Account[],
  retirementYear: number,
): FundingBreakdown {
  const bucketOf = new Map<string, WithdrawalTaxBucket>();
  for (const a of accounts) bucketOf.set(a.id, accountTaxBucket(a));

  const f: FundingBreakdown = {
    socialSecurity: 0, otherIncome: 0, rmds: 0,
    withdrawalsCash: 0, withdrawalsTaxable: 0, withdrawalsPreTax: 0, withdrawalsRoth: 0,
    shortfall: 0, totalSpending: 0, totalFunded: 0, reinvestedSurplus: 0,
  };

  for (const y of years) {
    if (y.year < retirementYear) continue;
    const ss = y.income.socialSecurity;
    const other = otherInflows(y) + y.income.salaries;
    const rmds = rmdTotal(y);
    let wCash = 0, wTax = 0, wPre = 0, wRoth = 0;
    for (const [accId, amt] of Object.entries(y.withdrawals.byAccount)) {
      switch (bucketOf.get(accId) ?? "taxable") {
        case "cash": wCash += amt; break;
        case "taxable": wTax += amt; break;
        case "preTax": wPre += amt; break;
        case "roth": wRoth += amt; break;
      }
    }
    const inflow = ss + other + rmds + wCash + wTax + wPre + wRoth;

    // Draw each source against the year's expenses in the order the engine
    // supplies the cash: income first, then the RMD it is forced to distribute,
    // then discretionary withdrawals. Anything left over never funded spending
    // — it was reinvested — so counting it would make the funding bar total
    // more than the retirement it is supposed to pay for.
    let remaining = y.totalExpenses;
    const draw = (amount: number) => {
      const used = Math.min(remaining, amount);
      remaining -= used;
      return used;
    };

    f.socialSecurity += draw(ss);
    f.otherIncome += draw(other);
    f.rmds += draw(rmds);
    f.withdrawalsCash += draw(wCash);
    f.withdrawalsTaxable += draw(wTax);
    f.withdrawalsPreTax += draw(wPre);
    f.withdrawalsRoth += draw(wRoth);

    f.totalSpending += y.totalExpenses;
    f.totalFunded += Math.min(y.totalExpenses, inflow);
    f.shortfall += Math.max(0, y.totalExpenses - inflow);
    f.reinvestedSurplus += Math.max(0, inflow - y.totalExpenses);
  }
  return f;
}
