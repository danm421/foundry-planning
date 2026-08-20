import { and, eq, gt, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, recurringTransactions, transactionCategories } from "@/db/schema";
import {
  detectRecurringSuggestions,
  type SuggestionSensitivity,
} from "@/lib/portal/recurring-suggestions";
import type { RecurringSuggestionDTO } from "@/lib/portal/contracts";

export type { SuggestionSensitivity };

/** How far back suggestion detection reads. Two years plus a month, so a bill
 *  paid once a year still has two occurrences to show a rhythm. */
const SUGGESTION_LOOKBACK_MONTHS = 25;

export function ymd(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function suggestionLookbackFrom(now: Date): string {
  return ymd(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - SUGGESTION_LOOKBACK_MONTHS, 1)),
  );
}

/** Candidates for suggestions: settled spend nothing has claimed yet. Shared so
 *  the Recurring tab's first pass and the client's "search for more" read the
 *  very same pool — a suggestion that appeared in one and not the other, purely
 *  because the two queries drifted apart, would be a bug nobody could explain. */
export function selectSuggestionCandidates(clientId: string, since: string) {
  return db
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
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        eq(plaidTransactions.excluded, false),
        eq(plaidTransactions.pending, false),
        eq(plaidTransactions.type, "expense"),
        isNull(plaidTransactions.recurringTransactionId),
        gt(plaidTransactions.amount, "0"),
        gte(plaidTransactions.date, since),
      ),
    );
}

/** Detection on its own, for the button that asks us to look again. The tab's
 *  own first pass comes bundled inside `loadRecurringsData`; this is the same
 *  detection over the same pool, run at whichever sensitivity was asked for. */
export async function loadRecurringSuggestions(
  clientId: string,
  now: Date,
  sensitivity: SuggestionSensitivity,
): Promise<RecurringSuggestionDTO[]> {
  const [rows, cats, unclaimed] = await Promise.all([
    db.select().from(recurringTransactions).where(eq(recurringTransactions.clientId, clientId)),
    db
      .select({
        id: transactionCategories.id,
        name: transactionCategories.name,
        color: transactionCategories.color,
        icon: transactionCategories.icon,
      })
      .from(transactionCategories)
      .where(eq(transactionCategories.clientId, clientId)),
    selectSuggestionCandidates(clientId, suggestionLookbackFrom(now)),
  ]);

  return detectRecurringSuggestions({
    transactions: unclaimed.map((t) => ({
      id: t.id,
      merchantName: t.merchantName,
      name: t.name,
      amount: Number(t.amount),
      date: t.date,
      categoryId: t.categoryId,
      pfcDetailed: t.pfcDetailed,
    })),
    // A charge a rule already covers is not a suggestion — even one the
    // retroactive claim skipped because the client had categorised it by hand.
    existing: rows.map((r) => ({
      id: r.id,
      matchType: r.matchType,
      pattern: r.pattern,
      amountMin: Number(r.amountMin),
      amountMax: Number(r.amountMax),
      cadence: r.cadence,
      dueDay: r.dueDay,
      dueMonth: r.dueMonth,
      categoryId: r.categoryId,
      createdAt: r.createdAt,
    })),
    categories: cats,
    today: ymd(now),
    sensitivity,
  });
}
