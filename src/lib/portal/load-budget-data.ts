// src/lib/portal/load-budget-data.ts
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { budgets, plaidTransactions, recurringTransactions, transactionCategories } from "@/db/schema";
import { ensureCategoriesSeeded } from "@/lib/portal/seed-categories";
import {
  predictRecurringAmount,
  isRecurringDueInMonth,
  type RecurringLike,
} from "@/lib/portal/recurring-matching";
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
      type: plaidTransactions.type,
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

  const [recRows, claimed, hist] = await Promise.all([
    db
      .select()
      .from(recurringTransactions)
      .where(eq(recurringTransactions.clientId, clientId)),

    db
      .select({
        recurringTransactionId: plaidTransactions.recurringTransactionId,
        amount: plaidTransactions.amount,
      })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          isNotNull(plaidTransactions.recurringTransactionId),
          gte(plaidTransactions.date, from),
          lte(plaidTransactions.date, to),
        ),
      ),

    db
      .select({
        recurringTransactionId: plaidTransactions.recurringTransactionId,
        amount: plaidTransactions.amount,
      })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          isNotNull(plaidTransactions.recurringTransactionId),
        ),
      ),
  ]);

  const postedByRec = new Map<string, number>();
  for (const c of claimed) {
    if (!c.recurringTransactionId) continue;
    postedByRec.set(
      c.recurringTransactionId,
      (postedByRec.get(c.recurringTransactionId) ?? 0) + Number(c.amount),
    );
  }
  const histByRec = new Map<string, number[]>();
  for (const h of hist) {
    if (!h.recurringTransactionId) continue;
    const l = histByRec.get(h.recurringTransactionId) ?? [];
    l.push(Number(h.amount));
    histByRec.set(h.recurringTransactionId, l);
  }
  const recurringReservations = recRows
    .map((r) => {
      const like: RecurringLike = {
        id: r.id, matchType: r.matchType, pattern: r.pattern,
        amountMin: Number(r.amountMin), amountMax: Number(r.amountMax),
        cadence: r.cadence, dueDay: r.dueDay, dueMonth: r.dueMonth,
        categoryId: r.categoryId, createdAt: r.createdAt,
      };
      if (!isRecurringDueInMonth(like, month)) return null;
      const predicted = predictRecurringAmount(histByRec.get(r.id) ?? [], {
        amountMin: like.amountMin, amountMax: like.amountMax,
      });
      const posted = postedByRec.get(r.id) ?? 0;
      return { categoryId: r.categoryId, reservation: Math.max(0, predicted - posted) };
    })
    .filter((x): x is { categoryId: string; reservation: number } => x !== null);

  const summary = computeBudgetSummary({
    categories: cats as BudgetCategory[],
    budgets: buds.map((b) => ({
      categoryId: b.categoryId,
      monthlyAmount: Number(b.monthlyAmount),
    })),
    transactions: txns.map((t) => ({
      categoryId: t.categoryId,
      amount: Number(t.amount),
      type: t.type,
    })),
    recurrings: recurringReservations,
  });
  return { ...summary, month };
}
