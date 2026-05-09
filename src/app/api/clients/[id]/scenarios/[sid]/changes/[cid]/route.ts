// src/app/api/clients/[id]/scenarios/[sid]/changes/[cid]/route.ts
//
// PATCH a single scenario_change row. Two independent operations share this
// route:
//   1. Reassign `toggleGroupId` — used by the Changes-panel GroupEditor's
//      stage-then-Done flow (toggling a row's checkbox stages the membership
//      change client-side, and Done fans out one PATCH per staged change).
//   2. Flip `enabled` — used by the per-change toggle on each leaf row.
//      Disabled rows are filtered out by `loadScenarioChanges` so they never
//      reach the engine; the panel still shows them so the toggle is visible.
//
// Body shape (one or both fields, at least one required):
//   { toggleGroupId: <uuid> }     // move into the group
//   { toggleGroupId: null }       // clear group assignment (back to ungrouped)
//   { enabled: boolean }          // flip the per-change enabled flag
//
// Auth model: same as the sibling /changes route — `requireOrgId` then
// `assertScenarioRouteScope` (client-in-firm AND scenario-in-client). The
// change-id is then verified to belong to this scenario (404 on miss). When the
// target group is non-null, it's verified to belong to the same scenario (400
// on miss) so a leaked group id from a foreign scenario can't smuggle changes
// across.
//
// We don't need to re-check single-level-dependency here — the change is just
// being moved into an existing group, and the group's own dependency was
// validated when it was set on the toggle-group PATCH route (Task 5).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";

export const dynamic = "force-dynamic";

const PATCH_BODY = z
  .object({
    toggleGroupId: z.string().uuid().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) => v.toggleGroupId !== undefined || v.enabled !== undefined,
    { message: "Must provide toggleGroupId or enabled" },
  );

type RouteCtx = {
  params: Promise<{ id: string; sid: string; cid: string }>;
};

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId, cid: changeId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    // Verify the change-id lives under this scenario before parsing the body.
    // Same 404 posture as cross-firm scenarios — refuses to leak existence of
    // changes attached to a different scenario.
    const [change] = await db
      .select({ id: scenarioChanges.id })
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.id, changeId),
          eq(scenarioChanges.scenarioId, scenarioId),
        ),
      );
    if (!change) {
      return NextResponse.json(
        { error: "Change not found" },
        { status: 404 },
      );
    }

    const parsed = PATCH_BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // When moving into a group, ensure the target group belongs to this same
    // scenario. 400 (not 404) because the request shape is technically valid —
    // we just refuse to honor it.
    if (body.toggleGroupId != null) {
      const [group] = await db
        .select({ id: scenarioToggleGroups.id })
        .from(scenarioToggleGroups)
        .where(
          and(
            eq(scenarioToggleGroups.id, body.toggleGroupId),
            eq(scenarioToggleGroups.scenarioId, scenarioId),
          ),
        );
      if (!group) {
        return NextResponse.json(
          { error: "Target toggle group not found in this scenario" },
          { status: 400 },
        );
      }
    }

    const updates: Partial<typeof scenarioChanges.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.toggleGroupId !== undefined) {
      updates.toggleGroupId = body.toggleGroupId;
    }
    if (body.enabled !== undefined) {
      updates.enabled = body.enabled;
    }

    await db
      .update(scenarioChanges)
      .set(updates)
      .where(eq(scenarioChanges.id, changeId));

    if (body.toggleGroupId !== undefined) {
      await recordAudit({
        action: "toggle_group.move_change",
        resourceType: "scenario_change",
        resourceId: changeId,
        clientId,
        firmId,
        metadata: { scenarioId, toggleGroupId: body.toggleGroupId },
      });
    }
    if (body.enabled !== undefined) {
      await recordAudit({
        action: "scenario_change.set_enabled",
        resourceType: "scenario_change",
        resourceId: changeId,
        clientId,
        firmId,
        metadata: { scenarioId, enabled: body.enabled },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "PATCH /api/clients/[id]/scenarios/[sid]/changes/[cid] error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
