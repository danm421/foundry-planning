import { db } from "@/db";
import { accounts, plaidTransactions, transactionCategories } from "@/db/schema";
import { and, eq, gte, lte, or, ilike, desc, sql, isNull, isNotNull } from "drizzle-orm";

export type TransactionFilters = {
  from?: string;
  to?: string;
  categoryId?: string;
  q?: string;
  includeExcluded?: boolean;
  reviewed?: boolean;
  limit: number;
  offset: number;
};

export type PortalTransactionDTO = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  pending: boolean;
  excluded: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorizedBy: "plaid" | "rule" | "manual" | "recurring";
  accountId: string | null;
  accountName: string | null;
  accountMask: string | null;
  type: "income" | "expense" | "transfer";
  reviewed: boolean;
};

export function buildTransactionConditions(clientId: string, f: TransactionFilters) {
  const conds: unknown[] = [eq(plaidTransactions.clientId, clientId)];
  if (!f.includeExcluded) conds.push(eq(plaidTransactions.excluded, false));
  if (f.from) conds.push(gte(plaidTransactions.date, f.from));
  if (f.to) conds.push(lte(plaidTransactions.date, f.to));
  if (f.categoryId) conds.push(eq(plaidTransactions.categoryId, f.categoryId));
  if (f.reviewed === false) conds.push(isNull(plaidTransactions.reviewedAt));
  else if (f.reviewed === true) conds.push(isNotNull(plaidTransactions.reviewedAt));
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(plaidTransactions.merchantName, like), ilike(plaidTransactions.name, like)));
  }
  return conds;
}

export async function loadPortalTransactions(
  clientId: string,
  f: TransactionFilters,
): Promise<PortalTransactionDTO[]> {
  const rows = await db
    .select({
      id: plaidTransactions.id,
      date: plaidTransactions.date,
      name: plaidTransactions.name,
      merchantName: plaidTransactions.merchantName,
      amount: plaidTransactions.amount,
      pending: plaidTransactions.pending,
      excluded: plaidTransactions.excluded,
      categoryId: plaidTransactions.categoryId,
      categorizedBy: plaidTransactions.categorizedBy,
      accountId: plaidTransactions.accountId,
      categoryName: transactionCategories.name,
      categoryColor: transactionCategories.color,
      accountName: accounts.name,
      accountMask: accounts.accountNumberLast4,
      type: plaidTransactions.type,
      reviewedAt: plaidTransactions.reviewedAt,
    })
    .from(plaidTransactions)
    .leftJoin(transactionCategories, eq(transactionCategories.id, plaidTransactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, plaidTransactions.accountId))
    .where(and(...(buildTransactionConditions(clientId, f) as Parameters<typeof and>)))
    .orderBy(desc(plaidTransactions.date), desc(plaidTransactions.id))
    .limit(f.limit)
    .offset(f.offset);
  return rows.map(({ reviewedAt, ...r }) => ({ ...r, reviewed: reviewedAt != null })) as PortalTransactionDTO[];
}

export async function countPortalTransactions(
  clientId: string,
  f: TransactionFilters,
): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(plaidTransactions)
    .where(and(...(buildTransactionConditions(clientId, f) as Parameters<typeof and>)));
  return count ?? 0;
}
