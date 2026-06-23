import { db } from "@/db";
import { transactionRules, transactionCategories } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import type { RuleLike } from "./rule-matching";

export type CategorizationContext = { rules: RuleLike[]; slugToId: Map<string, string> };

export async function loadCategorizationContext(
  clientId: string,
): Promise<CategorizationContext> {
  const ruleRows = await db
    .select({
      matchType: transactionRules.matchType,
      pattern: transactionRules.pattern,
      categoryId: transactionRules.categoryId,
      priority: transactionRules.priority,
    })
    .from(transactionRules)
    .where(eq(transactionRules.clientId, clientId));

  const catRows = await db
    .select({ id: transactionCategories.id, slug: transactionCategories.slug })
    .from(transactionCategories)
    .where(and(eq(transactionCategories.clientId, clientId), isNotNull(transactionCategories.slug)));

  const slugToId = new Map<string, string>();
  for (const c of catRows) if (c.slug) slugToId.set(c.slug, c.id);

  return { rules: ruleRows as RuleLike[], slugToId };
}
