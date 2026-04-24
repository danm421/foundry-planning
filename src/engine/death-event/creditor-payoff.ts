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
 * accounts proportionally by current balance. Categories drain in the fixed
 * order above. `real_estate` and `business` accounts are never touched.
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
}): DrainResult {
  if (input.amountNeeded <= 0) {
    return { debits: [], drainedTotal: 0, residual: 0 };
  }

  let remaining = input.amountNeeded;
  const debits: Array<{ accountId: string; amount: number }> = [];

  for (const category of LIQUIDATION_CATEGORY_ORDER) {
    if (remaining <= 0) break;

    const eligible = input.accounts.filter(
      (a) =>
        a.category === category &&
        input.eligibilityFilter(a) &&
        (input.accountBalances[a.id] ?? 0) > 0,
    );
    if (eligible.length === 0) continue;

    const categoryTotal = eligible.reduce(
      (sum, a) => sum + (input.accountBalances[a.id] ?? 0),
      0,
    );
    if (categoryTotal <= 0) continue;

    if (categoryTotal <= remaining) {
      // Drain the entire category.
      for (const a of eligible) {
        const bal = input.accountBalances[a.id];
        debits.push({ accountId: a.id, amount: bal });
      }
      remaining -= categoryTotal;
    } else {
      // Proportional drain within this category.
      for (const a of eligible) {
        const bal = input.accountBalances[a.id];
        const share = (bal / categoryTotal) * remaining;
        debits.push({ accountId: a.id, amount: share });
      }
      remaining = 0;
    }
  }

  const drainedTotal = debits.reduce((s, d) => s + d.amount, 0);
  const residual = Math.max(0, input.amountNeeded - drainedTotal);
  return { debits, drainedTotal, residual };
}
