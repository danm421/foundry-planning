import { and, eq, gt, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions, plaidTransactions, transactionCategories } from "@/db/schema";
import { assembleRecurringView } from "@/lib/portal/recurring-matching";
import { detectRecurringSuggestions } from "@/lib/portal/recurring-suggestions";
import type { RecurringsData } from "@/lib/portal/recurring-matching";
import { currentMonthRange } from "@/lib/portal/load-budget-data";

export type { RecurringRowDTO, RecurringsData } from "@/lib/portal/recurring-matching";

function ymd(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** How far back suggestion detection reads. Two years plus a month, so a bill
 *  paid once a year still has two occurrences to show a rhythm. */
const SUGGESTION_LOOKBACK_MONTHS = 25;

function lookbackFrom(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return ymd(d);
}

export async function loadRecurringsData(clientId: string, now: Date): Promise<RecurringsData> {
  const { from, to, month } = currentMonthRange(now);

  const [rows, claimed, history, cats, unclaimed] = await Promise.all([
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
        eq(plaidTransactions.excluded, false),
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

    // Candidates for suggestions: settled spend nothing has claimed yet.
    db
      .select({
        id: plaidTransactions.id,
        merchantName: plaidTransactions.merchantName,
        name: plaidTransactions.name,
        amount: plaidTransactions.amount,
        date: plaidTransactions.date,
        categoryId: plaidTransactions.categoryId,
        pfcDetailed: plaidTransactions.pfcDetailed,
      })
      .from(plaidTransactions)
      .where(and(
        eq(plaidTransactions.clientId, clientId),
        eq(plaidTransactions.excluded, false),
        eq(plaidTransactions.pending, false),
        eq(plaidTransactions.type, "expense"),
        isNull(plaidTransactions.recurringTransactionId),
        gt(plaidTransactions.amount, "0"),
        gte(plaidTransactions.date, lookbackFrom(now, SUGGESTION_LOOKBACK_MONTHS)),
      )),
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
    suggestions: detectRecurringSuggestions({
      transactions: unclaimed.map((t) => ({
        id: t.id, merchantName: t.merchantName, name: t.name,
        amount: Number(t.amount), date: t.date, categoryId: t.categoryId,
        pfcDetailed: t.pfcDetailed,
      })),
      // A charge a rule already covers is not a suggestion — even one the
      // retroactive claim skipped because the client had categorised it by hand.
      existing: rows.map((r) => ({
        id: r.id, matchType: r.matchType, pattern: r.pattern,
        amountMin: Number(r.amountMin), amountMax: Number(r.amountMax),
        cadence: r.cadence, dueDay: r.dueDay, dueMonth: r.dueMonth,
        categoryId: r.categoryId, createdAt: r.createdAt,
      })),
      categories: cats,
      today: ymd(now),
    }),
  });
}
