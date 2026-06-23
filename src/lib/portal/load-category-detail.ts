// src/lib/portal/load-category-detail.ts
//
// DB loader for the portal Budget category-detail panel. Pulls a 24-month spend
// history (the depth Plaid first-syncs), per-year metrics, and a recent
// transaction list for a single category. Groups aggregate over their leaf ids
// (transactions categorize to leaves only), leaves over themselves. Pure shaping
// lives in category-detail.ts; this file is the only IO boundary.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgets, plaidTransactions, transactionCategories } from "@/db/schema";
import { categoryEmoji } from "@/lib/portal/category-emoji";
import {
  buildHistory,
  computeYearMetrics,
  monthsWindow,
  type CategoryDetail,
  type CategoryTransaction,
} from "@/lib/portal/category-detail";

const HISTORY_MONTHS = 24;
const TXN_LIMIT = 60;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function loadCategoryDetail(
  clientId: string,
  categoryId: string,
  now: Date,
): Promise<CategoryDetail | null> {
  const [cat] = await db
    .select({
      id: transactionCategories.id,
      parentId: transactionCategories.parentId,
      name: transactionCategories.name,
      slug: transactionCategories.slug,
      color: transactionCategories.color,
      kind: transactionCategories.kind,
    })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.id, categoryId),
        eq(transactionCategories.clientId, clientId),
      ),
    )
    .limit(1);
  if (!cat) return null;

  // Resolve the leaf ids whose transactions roll up into this view.
  let targetIds: string[];
  if (cat.kind === "group") {
    const leaves = await db
      .select({ id: transactionCategories.id })
      .from(transactionCategories)
      .where(
        and(
          eq(transactionCategories.parentId, categoryId),
          eq(transactionCategories.clientId, clientId),
        ),
      );
    targetIds = leaves.map((l) => l.id);
  } else {
    targetIds = [categoryId];
  }

  const months = monthsWindow(now, HISTORY_MONTHS);
  const windowStart = `${months[0]}-01`;
  const currentMonth = months[months.length - 1];

  // Budget for this category: explicit on the category wins; a group with no
  // explicit budget falls back to the sum of its leaf budgets (matches the
  // precedence in budget-summary.ts).
  const budgetRows = await db
    .select({
      categoryId: budgets.categoryId,
      monthlyAmount: budgets.monthlyAmount,
    })
    .from(budgets)
    .where(
      and(
        eq(budgets.clientId, clientId),
        inArray(budgets.categoryId, [categoryId, ...targetIds]),
      ),
    );
  const budgetByCat = new Map(
    budgetRows.map((b) => [b.categoryId, Number(b.monthlyAmount)]),
  );
  const explicit = budgetByCat.get(categoryId);
  let monthlyBudget: number | null;
  if (explicit != null) {
    monthlyBudget = explicit;
  } else if (cat.kind === "group") {
    const leafSum = targetIds.reduce((s, id) => s + (budgetByCat.get(id) ?? 0), 0);
    monthlyBudget = leafSum > 0 ? round2(leafSum) : null;
  } else {
    monthlyBudget = null;
  }

  // No leaves (empty group) → nothing to aggregate.
  let byMonth: Record<string, number> = {};
  let transactions: CategoryTransaction[] = [];
  if (targetIds.length > 0) {
    const monthKey = sql<string>`to_char(${plaidTransactions.date}, 'YYYY-MM')`;
    const aggRows = await db
      .select({ month: monthKey, total: sql<string>`sum(${plaidTransactions.amount})` })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          inArray(plaidTransactions.categoryId, targetIds),
          gte(plaidTransactions.date, windowStart),
        ),
      )
      .groupBy(monthKey);
    byMonth = Object.fromEntries(aggRows.map((r) => [r.month, Number(r.total)]));

    const txnRows = await db
      .select({
        id: plaidTransactions.id,
        date: plaidTransactions.date,
        name: plaidTransactions.name,
        merchantName: plaidTransactions.merchantName,
        amount: plaidTransactions.amount,
        categoryName: transactionCategories.name,
        categoryColor: transactionCategories.color,
      })
      .from(plaidTransactions)
      .leftJoin(
        transactionCategories,
        eq(transactionCategories.id, plaidTransactions.categoryId),
      )
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          inArray(plaidTransactions.categoryId, targetIds),
          gte(plaidTransactions.date, windowStart),
        ),
      )
      .orderBy(desc(plaidTransactions.date), desc(plaidTransactions.id))
      .limit(TXN_LIMIT);
    transactions = txnRows.map((t) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      merchantName: t.merchantName,
      amount: Number(t.amount),
      categoryName: t.categoryName,
      categoryColor: t.categoryColor ?? cat.color,
    }));
  }

  const spentThisMonth = round2(byMonth[currentMonth] ?? 0);

  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    color: cat.color,
    emoji: categoryEmoji(cat.slug),
    kind: cat.kind,
    monthlyBudget,
    spentThisMonth,
    remainingThisMonth:
      monthlyBudget == null ? null : round2(monthlyBudget - spentThisMonth),
    history: buildHistory(byMonth, months, monthlyBudget),
    metrics: computeYearMetrics(byMonth),
    transactions,
  };
}
