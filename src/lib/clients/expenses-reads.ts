import { db } from "@/db";
import { expenses } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Whether (client, scenario) holds a living-expense row the engine will
 * actually let spend the household's remaining cash flow.
 *
 * The three conditions are the ENGINE'S, not a convenient subset of them:
 * `absorbingLivingRow` (`src/engine/surplus-spend.ts`) requires `type = living`
 * and the flag, and skips any row with an entity or business owner — such a row
 * is not paid from household cash, so a flag on one is inert. Asking a looser
 * question here would answer "yes, this household absorbs" about a plan whose
 * chart is still flat, which is the one wrong answer this read can give.
 *
 * Deliberately NOT proration-gated to a year: the caller's question is whether
 * the household is set up to absorb at all, not whether it does so in 2041.
 */
export async function hasAbsorbingLivingRow(
  clientId: string,
  scenarioId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(
      and(
        eq(expenses.clientId, clientId),
        eq(expenses.scenarioId, scenarioId),
        eq(expenses.type, "living"),
        eq(expenses.absorbsRemainingCashFlow, true),
        isNull(expenses.ownerEntityId),
        isNull(expenses.ownerAccountId),
      ),
    )
    .limit(1);
  return row != null;
}
