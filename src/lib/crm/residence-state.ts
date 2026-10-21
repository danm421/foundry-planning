// src/lib/crm/residence-state.ts
//
// A household's state of residence lives in two places: the CRM household's
// `state` and the base case's `plan_settings.residence_state`, which state
// income and estate tax compute on. Once a household has a planning client the
// plan's copy is the truth — the CRM overview, the intake prefill and the
// divorce default all read it — and every CRM-side write lands on both.
// Scenarios keep their own residence state; only the base case is linked.
import { and, eq } from "drizzle-orm";
import { clients, planSettings, scenarios } from "@/db/schema";
import type { DbOrTx } from "@/lib/db-tx";

/** The base case's residence state; null when the plan has none (flat-rate fallback). */
export async function baseCaseResidenceState(handle: DbOrTx, clientId: string): Promise<string | null> {
  const [row] = await handle
    .select({ state: planSettings.residenceState })
    .from(planSettings)
    .innerJoin(scenarios, eq(scenarios.id, planSettings.scenarioId))
    .where(and(eq(planSettings.clientId, clientId), eq(scenarios.isBaseCase, true)));
  return row?.state ?? null;
}

/**
 * Write a CRM household's new state onto its planning client's base case.
 * Null when the household has no planning client — nothing to write.
 */
export async function writeResidenceStateToPlan(
  handle: DbOrTx,
  args: { householdId: string; firmId: string; state: string },
): Promise<{ clientId: string; planSettingsId: string } | null> {
  const [base] = await handle
    .select({ clientId: clients.id, scenarioId: scenarios.id })
    .from(clients)
    .innerJoin(scenarios, and(eq(scenarios.clientId, clients.id), eq(scenarios.isBaseCase, true)))
    .where(and(eq(clients.crmHouseholdId, args.householdId), eq(clients.firmId, args.firmId)));
  if (!base) return null;

  const [row] = await handle
    .update(planSettings)
    .set({ residenceState: args.state, updatedAt: new Date() })
    .where(and(eq(planSettings.clientId, base.clientId), eq(planSettings.scenarioId, base.scenarioId)))
    .returning({ id: planSettings.id });
  return row ? { clientId: base.clientId, planSettingsId: row.id } : null;
}
