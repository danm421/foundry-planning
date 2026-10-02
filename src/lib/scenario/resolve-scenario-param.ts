// src/lib/scenario/resolve-scenario-param.ts
//
// Resolves a route's `?scenario=` param to the scenario partition a read or
// write should land in, for the tables that carry a real `scenario_id`
// (`gift_series` today) rather than overlaying through `scenario_changes`.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { verifyClientAccess } from "@/lib/clients/authz";

/**
 * The client's base-case scenario id, or null when the caller cannot access the
 * client or it has none. Throws when more than one base case exists, so that
 * data-integrity bug surfaces loudly rather than picking an arbitrary row.
 */
export async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  // LIMIT 2 to surface the "multiple base scenarios" data-integrity bug loudly
  // rather than silently picking an arbitrary one.
  const baseScenarios = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(2);

  if (baseScenarios.length > 1) {
    throw new Error(
      `Multiple base scenarios for client ${clientId}: invariant violated`,
    );
  }
  return baseScenarios[0]?.id ?? null;
}

/**
 * The scenario partition a read/write should land in. `null`/`"base"` resolve to
 * the base case; any other value must be a scenario of THIS client, and the
 * client must be accessible to the caller (verified first), so a foreign or
 * unknown id returns undefined and the caller 404s instead of touching another
 * client's or firm's data.
 */
export async function resolveScenarioId(
  clientId: string,
  requested: string | null,
): Promise<string | null | undefined> {
  if (requested == null || requested === "base") {
    return getBaseCaseScenarioId(clientId);
  }
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return undefined;
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.id, requested), eq(scenarios.clientId, clientId)));
  return scenario?.id;
}
