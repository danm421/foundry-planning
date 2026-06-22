import { db } from "@/db";
import { plaidTransactions } from "@/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";

function matchPredicate(matchType: "exact" | "contains", pattern: string) {
  const p = pattern.trim();
  if (matchType === "exact") {
    return sql`(lower(${plaidTransactions.merchantName}) = lower(${p}) OR lower(${plaidTransactions.name}) = lower(${p}))`;
  }
  const like = `%${p}%`;
  return sql`(${plaidTransactions.merchantName} ILIKE ${like} OR ${plaidTransactions.name} ILIKE ${like})`;
}

export async function applyRuleRetroactively(
  clientId: string,
  rule: { id: string; matchType: "exact" | "contains"; pattern: string; categoryId: string },
): Promise<number> {
  const updated = await db
    .update(plaidTransactions)
    .set({ categoryId: rule.categoryId, categorizedBy: "rule", updatedAt: new Date() })
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        ne(plaidTransactions.categorizedBy, "manual"),
        matchPredicate(rule.matchType, rule.pattern),
      ),
    )
    .returning({ id: plaidTransactions.id });
  return updated.length;
}

export async function countRuleMatches(
  clientId: string,
  matchType: "exact" | "contains",
  pattern: string,
): Promise<number> {
  if (!pattern.trim()) return 0;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(plaidTransactions)
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        ne(plaidTransactions.categorizedBy, "manual"),
        matchPredicate(matchType, pattern),
      ),
    );
  return count ?? 0;
}
