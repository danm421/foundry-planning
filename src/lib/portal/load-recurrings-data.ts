import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions, plaidTransactions, transactionCategories } from "@/db/schema";
import { assembleRecurringView } from "@/lib/portal/recurring-matching";
import type { RecurringsData } from "@/lib/portal/recurring-matching";
import { currentMonthRange } from "@/lib/portal/load-budget-data";

export type { RecurringRowDTO, RecurringsData } from "@/lib/portal/recurring-matching";

function ymd(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
}

export async function loadRecurringsData(clientId: string, now: Date): Promise<RecurringsData> {
  const { from, to, month } = currentMonthRange(now);

  const [rows, claimed, history, cats] = await Promise.all([
    db.select().from(recurringTransactions).where(eq(recurringTransactions.clientId, clientId)),

    db
      .select({ recurringTransactionId: plaidTransactions.recurringTransactionId, amount: plaidTransactions.amount })
      .from(plaidTransactions)
      .where(and(
        eq(plaidTransactions.clientId, clientId),
        eq(plaidTransactions.excluded, false),
        isNotNull(plaidTransactions.recurringTransactionId),
        gte(plaidTransactions.date, from),
        lte(plaidTransactions.date, to),
      )),

    db
      .select({
        recurringTransactionId: plaidTransactions.recurringTransactionId,
        amount: plaidTransactions.amount,
        date: plaidTransactions.date,
      })
      .from(plaidTransactions)
      .where(and(
        eq(plaidTransactions.clientId, clientId),
        isNotNull(plaidTransactions.recurringTransactionId),
      )),

    db
      .select({
        id: transactionCategories.id,
        name: transactionCategories.name,
        color: transactionCategories.color,
        icon: transactionCategories.icon,
      })
      .from(transactionCategories)
      .where(eq(transactionCategories.clientId, clientId)),
  ]);

  return assembleRecurringView({
    rows: rows.map((r) => ({
      id: r.id, name: r.name, matchType: r.matchType, pattern: r.pattern,
      amountMin: Number(r.amountMin), amountMax: Number(r.amountMax), cadence: r.cadence,
      dueDay: r.dueDay, dueMonth: r.dueMonth, categoryId: r.categoryId,
    })),
    claimedThisMonth: claimed.map((c) => ({
      recurringTransactionId: c.recurringTransactionId, amount: Number(c.amount),
    })),
    history: history.map((h) => ({
      recurringTransactionId: h.recurringTransactionId, amount: Number(h.amount), date: h.date,
    })),
    categories: cats,
    month, today: ymd(now), now,
  });
}
