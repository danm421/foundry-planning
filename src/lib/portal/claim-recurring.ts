import { db } from "@/db";
import { plaidTransactions } from "@/db/schema";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";

function matchSql(matchType: "exact" | "contains", pattern: string) {
  const p = pattern.trim();
  if (matchType === "exact") {
    return sql`(lower(${plaidTransactions.merchantName}) = lower(${p}) OR lower(${plaidTransactions.name}) = lower(${p}))`;
  }
  const like = `%${p}%`;
  return sql`(${plaidTransactions.merchantName} ILIKE ${like} OR ${plaidTransactions.name} ILIKE ${like})`;
}

export async function claimRecurringRetroactively(
  clientId: string,
  r: {
    id: string;
    matchType: "exact" | "contains";
    pattern: string;
    amountMin: number;
    amountMax: number;
    categoryId: string;
  },
): Promise<number> {
  if (!r.pattern.trim()) return 0;
  const updated = await db
    .update(plaidTransactions)
    .set({
      recurringTransactionId: r.id,
      categoryId: r.categoryId,
      categorizedBy: "recurring",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        ne(plaidTransactions.categorizedBy, "manual"),
        gte(plaidTransactions.amount, String(r.amountMin)),
        lte(plaidTransactions.amount, String(r.amountMax)),
        matchSql(r.matchType, r.pattern),
      ),
    )
    .returning({ id: plaidTransactions.id });
  return updated.length;
}

export async function previewRecurringMatches(
  clientId: string,
  params: {
    matchType: "exact" | "contains";
    pattern: string;
    amountMin: number;
    amountMax: number;
  },
): Promise<{
  count: number;
  sample: { id: string; merchantName: string | null; name: string; amount: string; date: string }[];
}> {
  if (!params.pattern.trim()) return { count: 0, sample: [] };
  const where = and(
    eq(plaidTransactions.clientId, clientId),
    gte(plaidTransactions.amount, String(params.amountMin)),
    lte(plaidTransactions.amount, String(params.amountMax)),
    matchSql(params.matchType, params.pattern),
  );
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(plaidTransactions)
    .where(where);
  const sample = await db
    .select({
      id: plaidTransactions.id,
      merchantName: plaidTransactions.merchantName,
      name: plaidTransactions.name,
      amount: plaidTransactions.amount,
      date: plaidTransactions.date,
    })
    .from(plaidTransactions)
    .where(where)
    .orderBy(desc(plaidTransactions.date))
    .limit(5);
  return { count: count ?? 0, sample };
}

export async function unclaimRecurring(clientId: string, recurringId: string): Promise<void> {
  await db
    .update(plaidTransactions)
    .set({ recurringTransactionId: null, updatedAt: new Date() })
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        eq(plaidTransactions.recurringTransactionId, recurringId),
      ),
    );
}
