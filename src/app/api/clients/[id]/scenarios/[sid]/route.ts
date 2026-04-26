// src/app/api/clients/[id]/scenarios/[sid]/route.ts
//
// PATCH  → rename a scenario (only the `name` is mutable here).
// POST   → duplicate this scenario into a new scenario row under the same
//          client (clones toggle groups + scenario_changes via the shared
//          `createScenarioWithClone` helper).
// DELETE → delete a scenario. Cascade-deletes scenario_changes +
//          scenario_toggle_groups per Plan 1 schema. Snapshots survive (their
//          FK is intentionally not cascade — see parent spec §3.1). Refuses
//          to delete the base case to avoid orphaning the client's projection
//          state.
//
// Auth model mirrors Task 3 (changes route): `requireOrgId` then the shared
// `assertScenarioRouteScope` helper that 404s on (a) client outside firm or
// (b) scenario not under client. Returning 404 (not 403) for cross-firm probes
// prevents existence-leaks of foreign scenario ids.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { createScenarioWithClone } from "@/lib/scenario/create-with-clone";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";

export const dynamic = "force-dynamic";

const PATCH_BODY = z.object({
  name: z.string().min(1).max(60).regex(/\S/, "name must not be empty"),
});

type RouteCtx = { params: Promise<{ id: string; sid: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    const parsed = PATCH_BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await db
      .update(scenarios)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(scenarios.id, scenarioId));

    await recordAudit({
      action: "scenario.rename",
      resourceType: "scenario",
      resourceId: scenarioId,
      clientId,
      firmId,
      metadata: { name: parsed.data.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("PATCH /api/clients/[id]/scenarios/[sid] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    // Duplicate into a new scenario under the same client. Name follows the
    // "<source name> (copy)" convention; the UI is free to PATCH it after.
    const { scenario: created } = await createScenarioWithClone({
      clientId,
      name: `${scope.scenario.name} (copy)`,
      source: { kind: "scenario", sourceId: scenarioId },
    });

    await recordAudit({
      action: "scenario.duplicate",
      resourceType: "scenario",
      resourceId: created.id,
      clientId,
      firmId,
      metadata: { sourceScenarioId: scenarioId, name: created.name },
    });

    return NextResponse.json({ scenario: created }, { status: 201 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/scenarios/[sid] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    // Refuse to delete the base case — every overlay scenario reads from it,
    // and the base-only trigger from Plan 1 prevents recreating its rows
    // without an existing base scenario. Hard 400 so a UI bug can't nuke it.
    if (scope.scenario.isBaseCase) {
      return NextResponse.json(
        { error: "Cannot delete the base case scenario" },
        { status: 400 },
      );
    }

    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));

    await recordAudit({
      action: "scenario.delete",
      resourceType: "scenario",
      resourceId: scenarioId,
      clientId,
      firmId,
      metadata: { name: scope.scenario.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("DELETE /api/clients/[id]/scenarios/[sid] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
