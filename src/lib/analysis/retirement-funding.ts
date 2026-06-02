// src/lib/analysis/retirement-funding.ts
//
// Lifetime funding decomposition for the Retirement Summary report. Splits each
// retirement year's cash toward expenses into Social Security, other income,
// RMDs, and supplemental withdrawals (by tax bucket), then sums retirement→EOL.
//
// Withdrawal bucketing mirrors src/lib/comparison/withdrawal-categories.ts: the
// engine does not expose the designated-Roth slice inside a 401k/403b draw, so
// those accounts count fully as pre-tax. Roth = roth_ira accounts only.
import type { Account, ProjectionYear } from "@/engine/types";
import { otherInflows, rmdTotal } from "@/lib/analysis/retirement-inflows";

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
  /** Everything funded (all sources except shortfall). */
  totalFunded: number;
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
    shortfall: 0, totalSpending: 0, totalFunded: 0,
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
    const funded = ss + other + rmds + wCash + wTax + wPre + wRoth;
    f.socialSecurity += ss;
    f.otherIncome += other;
    f.rmds += rmds;
    f.withdrawalsCash += wCash;
    f.withdrawalsTaxable += wTax;
    f.withdrawalsPreTax += wPre;
    f.withdrawalsRoth += wRoth;
    f.totalSpending += y.totalExpenses;
    f.totalFunded += funded;
    f.shortfall += Math.max(0, y.totalExpenses - funded);
  }
  return f;
}
