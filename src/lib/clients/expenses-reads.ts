import { db } from "@/db";
import { expenses, planSettings } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { isRetirementLivingExpense } from "@/lib/solver/living-expense";

/**
 * Whether (client, scenario) holds a CURRENT (working-years) living-expense row
 * the engine will actually let spend the household's remaining cash flow.
 *
 * The flag conditions are the ENGINE'S, not a convenient subset of them:
 * `absorbingLivingRow` (`src/engine/surplus-spend.ts`) requires `type = living`
 * and the flag, and skips any row with an entity or business owner — such a row
 * is not paid from household cash, so a flag on one is inert. Asking a looser
 * question here would answer "yes, this household absorbs" about a plan whose
 * chart is still flat, which is the one wrong answer this read can give.
 *
 * A RETIREMENT row that absorbs does not count: the caller's chart is about the
 * working years, whose surplus such a row never touches.
 *
 * Deliberately NOT proration-gated to a year: the caller's question is whether
 * the household is set up to absorb at all, not whether it does so in 2041.
 */
export async function hasAbsorbingCurrentLivingRow(
  clientId: string,
  scenarioId: string,
): Promise<boolean> {
  const rows = await db
    .select({
      type: expenses.type,
      startYear: expenses.startYear,
      endYear: expenses.endYear,
      startYearRef: expenses.startYearRef,
      planStartYear: planSettings.planStartYear,
    })
    .from(expenses)
    .innerJoin(
      planSettings,
      and(
        eq(planSettings.clientId, expenses.clientId),
        eq(planSettings.scenarioId, expenses.scenarioId),
      ),
    )
    .where(
      and(
        eq(expenses.clientId, clientId),
        eq(expenses.scenarioId, scenarioId),
        eq(expenses.type, "living"),
        eq(expenses.absorbsRemainingCashFlow, true),
        isNull(expenses.ownerEntityId),
        isNull(expenses.ownerAccountId),
      ),
    );
  return rows.some((r) => !isRetirementLivingExpense(r, r.planStartYear));
}
