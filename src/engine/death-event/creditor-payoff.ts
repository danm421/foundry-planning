import type { Account } from "../types";

export interface DrainResult {
  debits: Array<{ accountId: string; amount: number }>;
  drainedTotal: number;
  residual: number;
}

const LIQUIDATION_CATEGORY_ORDER: ReadonlyArray<Account["category"]> = [
  "cash",
  "taxable",
  "life_insurance",
  "retirement",
];

/**
 * Drain liquid accounts to cover `amountNeeded`. Within each category, debit
 * accounts proportionally by drainable balance (current balance × the
 * account's `drainableFraction`). Categories drain in the fixed order above.
 * `real_estate` and `business` accounts are never touched.
 *
 * If the liquid pool is exhausted before `amountNeeded` is satisfied, the
 * `residual` field in the returned DrainResult is > 0; the caller decides
 * what to do with the shortfall (4c's proportional-to-heirs fallback for
 * creditor-payoff; warning-only for estate-tax payment).
 */
export function drainLiquidAssets(input: {
  amountNeeded: number;
  accounts: Account[];
  accountBalances: Record<string, number>;
  eligibilityFilter: (acct: Account) => boolean;
  /** Fraction of an eligible account's balance that may actually be drained,
   *  0..1. Defaults to 1 (whole balance), which is the pre-gift behavior.
   *
   *  `eligibilityFilter` is binary and cannot express "70% of this account".
   *  An account authored [deceased 100%] with 30% gifted to a trust still
   *  passes the filter, and the drain took the trust's slice with it — while an
   *  AUTHORED 70/30 account was safely excluded, because controllingFamilyMember
   *  returns null once any entity row exists. This is that protection, for the
   *  overlay. Called once per eligible account per category pass. */
  drainableFraction?: (acct: Account) => number;
}): DrainResult {
  if (input.amountNeeded <= 0) {
    return { debits: [], drainedTotal: 0, residual: 0 };
  }
  const fractionOf = input.drainableFraction ?? (() => 1);

  let remaining = input.amountNeeded;
  const debits: Array<{ accountId: string; amount: number }> = [];

  for (const category of LIQUIDATION_CATEGORY_ORDER) {
    if (remaining <= 0) break;

    // Each eligible account's drainable balance, resolved once.
    const eligible = input.accounts
      .filter((a) => a.category === category && input.eligibilityFilter(a))
      .map((a) => ({
        accountId: a.id,
        amount:
          (input.accountBalances[a.id] ?? 0) * Math.max(0, Math.min(1, fractionOf(a))),
      }))
      .filter((d) => d.amount > 0);
    if (eligible.length === 0) continue;

    const categoryTotal = eligible.reduce((sum, d) => sum + d.amount, 0);
    if (categoryTotal <= 0) continue;

    if (categoryTotal <= remaining) {
      // Drain the entire category.
      debits.push(...eligible);
      remaining -= categoryTotal;
    } else {
      // Proportional drain within this category.
      for (const d of eligible) {
        debits.push({ accountId: d.accountId, amount: (d.amount / categoryTotal) * remaining });
      }
      remaining = 0;
    }
  }

  const drainedTotal = debits.reduce((s, d) => s + d.amount, 0);
  const residual = Math.max(0, input.amountNeeded - drainedTotal);
  return { debits, drainedTotal, residual };
}
