// src/lib/scenario/route-scope.ts
//
// Shared route-scope guard for /api/clients/[id]/scenarios/[sid]/* handlers.
// Verifies in one shot that:
//   1. the client belongs to the caller's firm, and
//   2. the scenario belongs to the client.
// On miss, returns a `NextResponse` so the handler can early-return without
// constructing the response itself. Returning 404 (not 403) for cross-firm
// probes prevents existence-leaks of foreign scenario ids — same posture as
// the rest of the per-client API surface.
//
// Lifted out of `src/app/api/clients/[id]/scenarios/[sid]/route.ts` so it can
// be shared with the toggle-groups CRUD route (Plan 2 Task 5) and any future
// per-scenario handler. Keeping it framework-thin (depends only on Drizzle +
// NextResponse) means it stays testable via the route handlers themselves.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarios } from "@/db/schema";
import { verifyClientAccess } from "@/lib/clients/authz";

export type ScenarioRouteScope =
  | { kind: "ok"; scenario: typeof scenarios.$inferSelect }
  | { kind: "miss"; response: NextResponse };

/**
 * Asserts the scenario belongs to the client AND the client belongs to the
 * firm. Returns either the loaded scenario row (handlers that need its name
 * or `isBaseCase` flag use it) or a 404 NextResponse to short-circuit on miss.
 */
export async function assertScenarioRouteScope(
  clientId: string,
  scenarioId: string,
  firmId: string,
): Promise<ScenarioRouteScope> {
  // Advisor-scope gate (Phase 1b): firm membership + staff↔advisor visibility.
  // Replaces the firm-only `findClientInFirm` so a planner can't reach a
  // scenario under a client outside their mapped advisors. Covers every
  // `scenarios/[sid]/*` route that routes through this shared helper.
  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return {
      kind: "miss",
      response: NextResponse.json(
        { error: "Client not found" },
        { status: 404 },
      ),
    };
  }
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(
      and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)),
    );
  if (!scenario) {
    return {
      kind: "miss",
      response: NextResponse.json(
        { error: "Scenario not found" },
        { status: 404 },
      ),
    };
  }
  return { kind: "ok", scenario };
}

type ScenarioOnlyLookup = { kind: "miss"; response: NextResponse } | { kind: "ok"; found: boolean };

/**
 * The `add` row through which `targetId` exists in `scenarioId`, or null. The
 * scenario is scoped to the client and firm first (via
 * `assertScenarioRouteScope`), so a foreign scenario id never reaches the
 * `scenario_changes` read. A scope miss comes back as the 404 response to
 * return as-is.
 */
async function findScenarioAdd(
  clientId: string,
  scenarioId: string,
  firmId: string,
  targetKind: "entity" | "account",
  targetId: string,
): Promise<{ kind: "miss"; response: NextResponse } | { kind: "ok"; add: { payload: unknown } | null }> {
  const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
  if (scope.kind === "miss") return scope;
  const [row] = await db
    .select({ payload: scenarioChanges.payload })
    .from(scenarioChanges)
    .where(
      and(
        eq(scenarioChanges.scenarioId, scenarioId),
        eq(scenarioChanges.targetKind, targetKind),
        eq(scenarioChanges.targetId, targetId),
        eq(scenarioChanges.opType, "add"),
      ),
    );
  return { kind: "ok", add: row ?? null };
}

/**
 * Whether `entityId` is a trust that exists only in `scenarioId` — a
 * `scenario_changes` add row, with no base `entities` row.
 */
export async function findScenarioOnlyEntity(
  clientId: string,
  scenarioId: string,
  firmId: string,
  entityId: string,
): Promise<ScenarioOnlyLookup> {
  const lookup = await findScenarioAdd(clientId, scenarioId, firmId, "entity", entityId);
  return lookup.kind === "miss" ? lookup : { kind: "ok", found: lookup.add !== null };
}

/**
 * Whether `accountId` is a top-level business that exists only in `scenarioId`
 * — a `scenario_changes` add row, with no base `accounts` row. Any other
 * scenario-added account is not found: per-year schedules are a top-level
 * business's alone.
 */
export async function findScenarioOnlyBusiness(
  clientId: string,
  scenarioId: string,
  firmId: string,
  accountId: string,
): Promise<ScenarioOnlyLookup> {
  const lookup = await findScenarioAdd(clientId, scenarioId, firmId, "account", accountId);
  if (lookup.kind === "miss") return lookup;
  const added = (lookup.add?.payload ?? null) as { category?: unknown; parentAccountId?: unknown } | null;
  return { kind: "ok", found: added?.category === "business" && added.parentAccountId == null };
}
