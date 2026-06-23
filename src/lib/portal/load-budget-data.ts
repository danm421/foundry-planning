// src/lib/portal/load-budget-data.ts
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { budgets, plaidTransactions, transactionCategories } from "@/db/schema";
import { ensureCategoriesSeeded } from "@/lib/portal/seed-categories";
import {
  computeBudgetSummary,
  type BudgetCategory,
  type BudgetSummary,
} from "@/lib/portal/budget-summary";

export function currentMonthRange(now: Date): {
  from: string;
  to: string;
  month: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  const mm = String(m + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
    month: `${y}-${mm}`,
  };
}

export async function loadBudgetSummary(
  clientId: string,
  now: Date,
): Promise<BudgetSummary & { month: string }> {
  await ensureCategoriesSeeded(clientId);
  const { from, to, month } = currentMonthRange(now);

  const cats = await db
    .select({
      id: transactionCategories.id,
      parentId: transactionCategories.parentId,
      name: transactionCategories.name,
      slug: transactionCategories.slug,
      color: transactionCategories.color,
      kind: transactionCategories.kind,
      sortOrder: transactionCategories.sortOrder,
    })
    .from(transactionCategories)
    .where(eq(transactionCategories.clientId, clientId));

  const buds = await db
    .select({
      categoryId: budgets.categoryId,
      monthlyAmount: budgets.monthlyAmount,
    })
    .from(budgets)
    .where(eq(budgets.clientId, clientId));

  // Pending INCLUDED (no pending filter); excluded omitted.
  const txns = await db
    .select({
      categoryId: plaidTransactions.categoryId,
      amount: plaidTransactions.amount,
    })
    .from(plaidTransactions)
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        eq(plaidTransactions.excluded, false),
        gte(plaidTransactions.date, from),
        lte(plaidTransactions.date, to),
      ),
    );

  const summary = computeBudgetSummary({
    categories: cats as BudgetCategory[],
    budgets: buds.map((b) => ({
      categoryId: b.categoryId,
      monthlyAmount: Number(b.monthlyAmount),
    })),
    transactions: txns.map((t) => ({
      categoryId: t.categoryId,
      amount: Number(t.amount),
    })),
  });
  return { ...summary, month };
}
