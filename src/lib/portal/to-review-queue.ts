// src/lib/portal/to-review-queue.ts
//
// One definition of the dashboard's "Transactions to review" queue: the WHERE
// that decides what is in it, the page of rows the tile shows, and the count
// behind that page. The dashboard loader and the review-queue route both read
// through here — a route that marked a different set than the tile displays
// would clear rows the client never saw.
import { and, desc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accounts, plaidTransactions, transactionCategories } from "@/db/schema";
import type { ReviewTxn } from "@/lib/portal/contracts";

/** Rows shown at once — also the batch size of the tile's "Mark these reviewed". */
export const REVIEW_PAGE_SIZE = 5;

/** In the queue: not excluded, not a transfer, not yet reviewed. */
export function toReviewWhere(clientId: string): SQL | undefined {
  return and(
    eq(plaidTransactions.clientId, clientId),
    eq(plaidTransactions.excluded, false),
    ne(plaidTransactions.type, "transfer"),
    isNull(plaidTransactions.reviewedAt),
  );
}

/** Newest first — the same order the tile has always shown. */
export async function toReviewPage(
  clientId: string,
  limit: number = REVIEW_PAGE_SIZE,
): Promise<ReviewTxn[]> {
  const rows = await db
    .select({
      id: plaidTransactions.id,
      date: plaidTransactions.date,
      name: plaidTransactions.name,
      merchantName: plaidTransactions.merchantName,
      amount: plaidTransactions.amount,
      accountName: accounts.name,
      categoryId: plaidTransactions.categoryId,
      categoryName: transactionCategories.name,
      categoryColor: transactionCategories.color,
    })
    .from(plaidTransactions)
    .leftJoin(accounts, eq(accounts.id, plaidTransactions.accountId))
    .leftJoin(transactionCategories, eq(transactionCategories.id, plaidTransactions.categoryId))
    .where(toReviewWhere(clientId))
    .orderBy(desc(plaidTransactions.date), desc(plaidTransactions.id))
    .limit(limit);

  return rows.map((t) => ({
    id: t.id,
    date: t.date,
    name: t.name,
    merchantName: t.merchantName,
    amount: Number(t.amount),
    accountName: t.accountName,
    categoryId: t.categoryId,
    categoryName: t.categoryName,
    categoryColor: t.categoryColor,
  }));
}

export async function toReviewCount(clientId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(plaidTransactions)
    .where(toReviewWhere(clientId));
  return rows[0]?.count ?? 0;
}
