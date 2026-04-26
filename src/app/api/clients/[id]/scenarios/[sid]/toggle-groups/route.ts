// src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/route.ts
//
// GET  → list toggle groups for a scenario, ordered by orderIndex.
// POST → create a new toggle group at the end of the scenario's group list
//        (next orderIndex = max(existing) + 1).
//
// Auth model: `requireOrgId` then the shared `assertScenarioRouteScope` helper
// guards both client-in-firm AND scenario-in-client. 404 (not 403) on miss to
// avoid existence-leaks of foreign scenario / group ids.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarioToggleGroups } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";

export const dynamic = "force-dynamic";

const CREATE = z.object({
  name: z.string().min(1).max(60).regex(/\S/, "name must not be empty"),
  defaultOn: z.boolean().default(true),
});

type RouteCtx = { params: Promise<{ id: string; sid: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    const groups = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, scenarioId))
      .orderBy(scenarioToggleGroups.orderIndex);

    return NextResponse.json({ groups });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "GET /api/clients/[id]/scenarios/[sid]/toggle-groups error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    const parsed = CREATE.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { name, defaultOn } = parsed.data;

    // Next orderIndex = max(existing) + 1, default 0 for the first group. We
    // read existing rows and compute in JS rather than a SQL aggregate because
    // the group count per scenario is tiny (UI caps at ~dozens) and this keeps
    // the helper boundary thin — no need for a typed `max` import.
    const existing = await db
      .select({ orderIndex: scenarioToggleGroups.orderIndex })
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, scenarioId));
    const nextOrderIndex = existing.length === 0
      ? 0
      : Math.max(...existing.map((g) => g.orderIndex)) + 1;

    const [created] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId,
        name,
        defaultOn,
        orderIndex: nextOrderIndex,
      })
      .returning();

    await recordAudit({
      action: "toggle_group.create",
      resourceType: "toggle_group",
      resourceId: created.id,
      clientId,
      firmId,
      metadata: {
        scenarioId,
        groupId: created.id,
        name,
        defaultOn,
      },
    });

    return NextResponse.json({ group: created }, { status: 201 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "POST /api/clients/[id]/scenarios/[sid]/toggle-groups error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
