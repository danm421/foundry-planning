import { and, eq } from "drizzle-orm";

import { clients, expenses, incomes } from "@/db/schema";
import type { ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Writes the plan-level values the advisor reviewed on the Plan basics step.
 *
 * BLANK IS A VALID COMMITTED STATE. A null field commits as no-change, leaving
 * the seeded $0 row in place — the advisor is flagged, never blocked. That is
 * why every write below is conditional on a non-null value rather than
 * coalescing to 0.
 *
 * Recomputes nothing: planEndAge is derived from the life expectancies at
 * projection-load time (see `applyLifeExpectancyHorizon` in
 * `src/lib/plan-horizon.ts`), and this module writes the same columns that
 * path reads from.
 */
export async function commitPlanBasics(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const basics = payload.planBasics;
  if (!basics) return result;

  const now = new Date();

  // ── 1. Client horizon columns. ──
  const clientPatch: Record<string, unknown> = {};
  if (basics.retirementAge.value != null) clientPatch.retirementAge = basics.retirementAge.value;
  if (basics.lifeExpectancy.value != null) clientPatch.lifeExpectancy = basics.lifeExpectancy.value;
  if (basics.spouseRetirementAge?.value != null) {
    clientPatch.spouseRetirementAge = basics.spouseRetirementAge.value;
  }
  if (basics.spouseLifeExpectancy?.value != null) {
    clientPatch.spouseLifeExpectancy = basics.spouseLifeExpectancy.value;
  }
  if (Object.keys(clientPatch).length > 0) {
    clientPatch.updatedAt = now;
    await tx
      .update(clients)
      .set(clientPatch)
      .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));
    result.updated += 1;
  }

  // ── 2. Seeded living-expense slots. Amounts only — timing is never touched,
  //       matching the existing slot rule in commit/expenses.ts. ──
  const slots = await tx
    .select({ id: expenses.id, name: expenses.name })
    .from(expenses)
    .where(
      and(
        eq(expenses.clientId, ctx.clientId),
        eq(expenses.scenarioId, ctx.scenarioId),
        eq(expenses.type, "living"),
        eq(expenses.isDefault, true),
      ),
    );

  for (const slot of slots) {
    const isRetirement = slot.name.toLowerCase().includes("retirement");
    const field = isRetirement ? basics.retirementLivingSpending : basics.currentLivingSpending;
    if (field.value == null) continue;
    await tx
      .update(expenses)
      .set({ annualAmount: String(field.value), updatedAt: now })
      .where(eq(expenses.id, slot.id));
    result.updated += 1;
  }

  // ── 3. Seeded Social Security rows, matched on type + owner. ──
  for (const row of basics.socialSecurity) {
    const patch: Record<string, unknown> = {};
    if (row.pia.value != null) patch.annualAmount = String(row.pia.value);
    if (row.claimingAge.value != null) patch.claimingAge = row.claimingAge.value;
    if (Object.keys(patch).length === 0) continue;
    patch.updatedAt = now;

    await tx
      .update(incomes)
      .set(patch)
      .where(
        and(
          eq(incomes.clientId, ctx.clientId),
          eq(incomes.scenarioId, ctx.scenarioId),
          eq(incomes.type, "social_security"),
          eq(incomes.owner, row.owner),
        ),
      );
    result.updated += 1;
  }

  return result;
}
