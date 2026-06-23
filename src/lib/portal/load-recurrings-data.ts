import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions, plaidTransactions } from "@/db/schema";
import {
  predictRecurringAmount,
  recurringPeriodState,
  isRecurringDueInMonth,
  type RecurringLike,
} from "@/lib/portal/recurring-matching";
import { currentMonthRange } from "@/lib/portal/load-budget-data";

export type RecurringRowDTO = {
  id: string;
  name: string;
  cadence: "monthly" | "annually";
  dueDay: number | null;
  dueMonth: number | null;
  categoryId: string;
  predicted: number;
  state: "paid" | "due" | "overdue";
  postedThisMonth: number;
};

function ymd(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
}

export async function loadRecurringsData(
  clientId: string,
  now: Date,
): Promise<{ recurrings: RecurringRowDTO[]; paidSoFar: number; leftToPay: number; month: string }> {
  const { from, to, month } = currentMonthRange(now);

  const rows = await db
    .select()
    .from(recurringTransactions)
    .where(eq(recurringTransactions.clientId, clientId));

  // All of this client's claimed transactions in the current month, grouped by recurring.
  const claimed = await db
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
    );
  const postedByRecurring = new Map<string, number>();
  for (const c of claimed) {
    if (!c.recurringTransactionId) continue;
    postedByRecurring.set(
      c.recurringTransactionId,
      (postedByRecurring.get(c.recurringTransactionId) ?? 0) + Number(c.amount),
    );
  }

  // History for prediction: all claimed amounts per recurring (any month).
  const history = await db
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
    );
  const historyByRecurring = new Map<string, number[]>();
  for (const h of history) {
    if (!h.recurringTransactionId) continue;
    const list = historyByRecurring.get(h.recurringTransactionId) ?? [];
    list.push(Number(h.amount));
    historyByRecurring.set(h.recurringTransactionId, list);
  }

  const today = ymd(now);
  let paidSoFar = 0;
  let leftToPay = 0;
  const recurrings: RecurringRowDTO[] = [];

  for (const r of rows) {
    const like: RecurringLike = {
      id: r.id, matchType: r.matchType, pattern: r.pattern,
      amountMin: Number(r.amountMin), amountMax: Number(r.amountMax),
      cadence: r.cadence, dueDay: r.dueDay, dueMonth: r.dueMonth,
      categoryId: r.categoryId, createdAt: r.createdAt,
    };
    const dueThisMonth = isRecurringDueInMonth(like, month);
    const postedThisMonth = postedByRecurring.get(r.id) ?? 0;
    const predicted = predictRecurringAmount(historyByRecurring.get(r.id) ?? [], {
      amountMin: like.amountMin, amountMax: like.amountMax,
    });
    const state = recurringPeriodState({
      dueDay: r.dueDay, today, hasMatchThisPeriod: postedThisMonth > 0,
    });
    recurrings.push({
      id: r.id, name: r.name, cadence: r.cadence, dueDay: r.dueDay,
      dueMonth: r.dueMonth, categoryId: r.categoryId, predicted, state, postedThisMonth,
    });
    if (dueThisMonth) {
      if (postedThisMonth > 0) {
        paidSoFar += postedThisMonth;
      } else {
        leftToPay += predicted;
      }
    }
  }

  return {
    recurrings,
    paidSoFar: Math.round((paidSoFar + Number.EPSILON) * 100) / 100,
    leftToPay: Math.round((leftToPay + Number.EPSILON) * 100) / 100,
    month,
  };
}
