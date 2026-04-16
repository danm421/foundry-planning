/**
 * Pure helpers that derive deduction inputs for the bracket tax engine.
 *
 * - deriveAboveLineFromSavings: sums employee contributions to traditional
 *   IRA / 401k accounts in the year (Roth and other account types excluded;
 *   employer match excluded since it never hits the employee's W-2)
 *
 * - sumItemizedFromEntries: sums itemized line items for the year, applying
 *   per-row inflation and the statutory $10k SALT cap
 */

export const SALT_CAP = 10000;

const DEDUCTIBLE_SUBTYPES = new Set(["traditional_ira", "401k"]);

export interface SavingsRuleForDeduction {
  accountId: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
}

export interface AccountForDeduction {
  id: string;
  subType: string;
  ownerEntityId?: string | null;
}

export interface ClientDeductionRow {
  type: "charitable_cash" | "charitable_non_cash" | "salt" | "mortgage_interest" | "other_itemized";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
}

export function deriveAboveLineFromSavings(
  year: number,
  savingsRules: SavingsRuleForDeduction[],
  accounts: AccountForDeduction[],
  isGrantorEntity: (entityId: string) => boolean
): number {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  let total = 0;
  for (const rule of savingsRules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct) continue;
    if (!DEDUCTIBLE_SUBTYPES.has(acct.subType)) continue;
    if (acct.ownerEntityId != null && !isGrantorEntity(acct.ownerEntityId)) continue;
    total += rule.annualAmount;
  }
  return total;
}

export function sumItemizedFromEntries(
  year: number,
  rows: ClientDeductionRow[]
): number {
  let salt = 0;
  let other = 0;

  for (const row of rows) {
    if (year < row.startYear || year > row.endYear) continue;
    const yearsSinceStart = year - row.startYear;
    const inflated = row.annualAmount * Math.pow(1 + row.growthRate, yearsSinceStart);
    if (row.type === "salt") {
      salt += inflated;
    } else {
      other += inflated;
    }
  }

  return Math.min(salt, SALT_CAP) + other;
}
