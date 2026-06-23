import { db } from "@/db";
import { transactionRules, transactionCategories, recurringTransactions } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import type { RuleLike } from "./rule-matching";
import type { RecurringLike } from "./recurring-matching";

export type CategorizationContext = { rules: RuleLike[]; recurrings: RecurringLike[]; slugToId: Map<string, string> };

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

  const recurringRows = await db
    .select({
      id: recurringTransactions.id,
      matchType: recurringTransactions.matchType,
      pattern: recurringTransactions.pattern,
      amountMin: recurringTransactions.amountMin,
      amountMax: recurringTransactions.amountMax,
      cadence: recurringTransactions.cadence,
      dueDay: recurringTransactions.dueDay,
      dueMonth: recurringTransactions.dueMonth,
      categoryId: recurringTransactions.categoryId,
      createdAt: recurringTransactions.createdAt,
    })
    .from(recurringTransactions)
    .where(eq(recurringTransactions.clientId, clientId));
  const recurrings: RecurringLike[] = recurringRows.map((r) => ({
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
  }));

  return { rules: ruleRows as RuleLike[], recurrings, slugToId };
}
