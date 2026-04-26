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
import { scenarios } from "@/db/schema";
import { findClientInFirm } from "@/lib/db-scoping";

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
  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) {
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
