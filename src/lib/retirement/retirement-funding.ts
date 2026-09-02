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
// `shortfall` and `reinvestedSurplus` are snapped to zero when they are only
// the projection's own arithmetic residue — see `isMaterialLifetimeAmount`.
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

/**
 * Is a lifetime funding figure real money, or the projection's own residue?
 *
 * `shortfall` and `reinvestedSurplus` each accumulate a per-year `Math.max(0, …)`
 * across two independently summed quantities, so a year the plan funds exactly
 * lands a little off zero rather than on it — and because the `max` keeps only
 * one sign, thirty-plus retirement years of that noise compound instead of
 * cancelling. A fully funded plan went to a client reading "Projected spending
 * exceeds available funding by $1 over retirement".
 *
 * The residue is the withdrawal solve's own tolerance, so it scales with the
 * cash moving through the year rather than with any fixed number of dollars.
 * That is why this is a SHARE of lifetime spending and not a dollar floor: a
 * $5.2M single-year draw leaves $1,565 behind where a $300k draw leaves $0.20,
 * and one flat threshold cannot be right for both.
 *
 * Measured over the 27 live plans on production (853 retirement years): the
 * largest residue was 0.030% of its plan's lifetime spending, and every other
 * one landed under 0.0020%. The smallest GENUINE shortfall was 3.6%. One part
 * in a thousand sits inside that gap — 3x clear of the worst residue, 36x below
 * the smallest real gap — and leans toward printing a small real shortfall
 * rather than hiding one, which is the safer way to be wrong.
 *
 * The per-YEAR sibling of this rule is `isMaterialShortfall`, which asks the
 * same question of a single year and answers it in whole dollars. Both exist so
 * that no caller has to re-derive "is this figure real" from `> 0`.
 */
const LIFETIME_RESIDUE_SHARE = 0.001;

export function isMaterialLifetimeAmount(amount: number, totalSpending: number): boolean {
  return amount > totalSpending * LIFETIME_RESIDUE_SHARE;
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

  // Drop both residues at the source rather than at each consumer. The funding
  // bar, the shortfall sentence, the reinvested-surplus row, the in-app summary
  // and the client portal's goal tile all read these two fields; a guard bolted
  // onto one of them leaves the others printing the residue, which is how "$1
  // unfunded" reached a client deck. `totalFunded` takes back what the shortfall
  // gives up, keeping `totalFunded + shortfall === totalSpending` exact.
  if (!isMaterialLifetimeAmount(f.shortfall, f.totalSpending)) {
    f.shortfall = 0;
    f.totalFunded = f.totalSpending;
  }
  if (!isMaterialLifetimeAmount(f.reinvestedSurplus, f.totalSpending)) {
    f.reinvestedSurplus = 0;
  }
  return f;
}
