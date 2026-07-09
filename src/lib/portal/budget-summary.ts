// src/lib/portal/budget-summary.ts
//
// Pure budget-vs-actual rollup for the portal Budget page. NO DB/Next/Plaid
// imports (so it is unit-testable in plain vitest). Phase 5 decisions:
//  - Group-level budgets allowed: an explicit group budget overrides the sum
//    of its leaf budgets for the group total (no double counting).
//  - Pending transactions are included by the caller (we just sum what we get).
//  - Expenses only: the seeded "income" group is excluded from groups/totals;
//    income/transfer classification comes from transaction `type`, not group slug.
//  - `transfer` rows are excluded from both spend and income.
//  - `income` rows tally into incomeThisMonth (Plaid: money-in is negative).
//  - `expense` rows roll up by leaf category as before.
//  - "actual" is the SIGNED Plaid sum (positive = money out) so refunds net down.

import type { LeafCell, GroupCell, BudgetSummary } from "@/lib/portal/contracts";
export type { LeafCell, GroupCell, BudgetSummary };

export type BudgetCategory = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string | null;
  color: string; // a var(--data-*) token
  kind: "group" | "category";
  sortOrder: number;
};
export type BudgetAmount = { categoryId: string; monthlyAmount: number };
export type BudgetTransaction = { categoryId: string | null; amount: number; type: "income" | "expense" | "transfer" };

const INCOME_GROUP_SLUG = "income";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeBudgetSummary(input: {
  categories: BudgetCategory[];
  budgets: BudgetAmount[];
  transactions: BudgetTransaction[];
  recurrings?: { categoryId: string; reservation: number }[];
}): BudgetSummary {
  const { categories, budgets, transactions, recurrings = [] } = input;
  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b.monthlyAmount]));

  const leavesByGroup = new Map<string, BudgetCategory[]>();
  for (const c of categories) {
    if (c.kind === "category" && c.parentId) {
      const list = leavesByGroup.get(c.parentId) ?? [];
      list.push(c);
      leavesByGroup.set(c.parentId, list);
    }
  }

  // Per-leaf signed actuals + income tally. Transactions are categorized to
  // leaves only (the PUT /transactions route rejects group categories).
  // income/transfer come from transaction `type` (not group slug).
  const actualByLeaf = new Map<string, number>();
  let incomeThisMonth = 0;
  for (const t of transactions) {
    if (t.type === "transfer") continue;           // internal transfers never count
    if (t.type === "income") {
      incomeThisMonth += -t.amount;                // Plaid: money in is negative
      continue;
    }
    if (t.categoryId == null) continue;            // uncategorized expense → no leaf
    actualByLeaf.set(t.categoryId, (actualByLeaf.get(t.categoryId) ?? 0) + t.amount);
  }

  // Recurring reservations: committed-but-unposted spend, folded into the leaf
  // actual so "Spent" reflects committed spend from day 1 (reserve & reconcile).
  for (const r of recurrings) {
    if (r.reservation <= 0) continue;
    actualByLeaf.set(r.categoryId, (actualByLeaf.get(r.categoryId) ?? 0) + r.reservation);
  }

  const groups = categories
    .filter((c) => c.kind === "group" && c.slug !== INCOME_GROUP_SLUG)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const groupCells: GroupCell[] = groups.map((g) => {
    const leafCats = (leavesByGroup.get(g.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const leaves: LeafCell[] = leafCats.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      color: l.color,
      budget: budgetByCat.has(l.id) ? budgetByCat.get(l.id)! : null,
      actual: round2(actualByLeaf.get(l.id) ?? 0),
    }));
    const actual = round2(leaves.reduce((s, l) => s + l.actual, 0));
    const explicit = budgetByCat.has(g.id);
    const hasLeafBudget = leaves.some((l) => l.budget != null);
    const leafSum = round2(leaves.reduce((s, l) => s + (l.budget ?? 0), 0));
    // The category sum is the FLOOR for the group. An explicit group budget only
    // raises the total above that sum; the difference is unallocated "excess"
    // room within the group. (Replaces the old override rule, where an explicit
    // group budget could sit BELOW the leaf sum.)
    const explicitGroup = explicit ? budgetByCat.get(g.id)! : null;
    const budget =
      explicitGroup != null
        ? Math.max(explicitGroup, leafSum)
        : hasLeafBudget
          ? leafSum
          : null;
    const unallocated =
      explicitGroup != null ? round2(Math.max(0, explicitGroup - leafSum)) : 0;
    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      color: g.color,
      budget,
      budgetIsExplicit: explicit,
      unallocated,
      actual,
      remaining: budget == null ? null : round2(budget - actual),
      leaves,
    };
  });

  const totalBudget = round2(groupCells.reduce((s, g) => s + (g.budget ?? 0), 0));
  const totalSpent = round2(groupCells.reduce((s, g) => s + g.actual, 0));

  return {
    groups: groupCells,
    totalBudget,
    totalSpent,
    totalRemaining: round2(totalBudget - totalSpent),
    incomeThisMonth: round2(incomeThisMonth),
  };
}
