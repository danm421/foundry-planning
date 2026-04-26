// src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/[gid]/route.ts
//
// PATCH  → rename / set defaultOn / set requiresGroupId on a single group.
//          requiresGroupId enforces three guards:
//            (a) self-reference rejected (group can't require itself),
//            (b) parent must live in the SAME scenario,
//            (c) single-level dependency only — parent's requiresGroupId must
//                itself be null. v1 doesn't support chains; the schema allows
//                them structurally so we enforce in the API layer.
// DELETE → delete the group. The `?moveChangesTo=` query param chooses the
//          fate of any scenario_changes rows that pointed at this group:
//            "ungrouped" (default) → reassign toggle_group_id = NULL
//            "delete"              → drop those scenario_changes rows entirely
//          The reassign-or-delete + group-delete pair runs in a transaction
//          so a UI tab-close mid-flight can't leave half-detached changes.
//
// Auth model: `requireOrgId` then `assertScenarioRouteScope` (client-in-firm
// AND scenario-in-client), then an inline check that `gid` belongs to `sid`.
// Keeping the gid check inline (not in the shared helper) keeps the helper's
// API surface narrow — only handlers that operate on a specific group need it.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";

export const dynamic = "force-dynamic";

const PATCH_BODY = z.object({
  name: z.string().min(1).max(60).regex(/\S/, "name must not be empty").optional(),
  defaultOn: z.boolean().optional(),
  // Nullable: passing `null` clears the dependency; passing a uuid sets it.
  // Omitting the key entirely leaves the existing value alone.
  requiresGroupId: z.string().uuid().nullable().optional(),
});

const DELETE_QUERY = z.object({
  moveChangesTo: z.enum(["ungrouped", "delete"]).default("ungrouped"),
});

type RouteCtx = {
  params: Promise<{ id: string; sid: string; gid: string }>;
};

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId, gid: groupId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    // Verify the gid lives under this sid before parsing the body. Same 404
    // posture as cross-firm scenarios — refuses to leak existence of groups
    // attached to a different scenario.
    const [group] = await db
      .select()
      .from(scenarioToggleGroups)
      .where(
        and(
          eq(scenarioToggleGroups.id, groupId),
          eq(scenarioToggleGroups.scenarioId, scenarioId),
        ),
      );
    if (!group) {
      return NextResponse.json(
        { error: "Toggle group not found" },
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

    // requiresGroupId guards: only run when the field is actually being set
    // to a non-null value. `null` is always allowed (clears the dependency).
    if (body.requiresGroupId != null) {
      // (a) self-reference
      if (body.requiresGroupId === groupId) {
        return NextResponse.json(
          { error: "Group cannot require itself" },
          { status: 400 },
        );
      }
      // (b) parent must live in the SAME scenario.
      // (c) parent's own requiresGroupId must be null (single-level only).
      const [parent] = await db
        .select({
          id: scenarioToggleGroups.id,
          scenarioId: scenarioToggleGroups.scenarioId,
          requiresGroupId: scenarioToggleGroups.requiresGroupId,
        })
        .from(scenarioToggleGroups)
        .where(eq(scenarioToggleGroups.id, body.requiresGroupId));
      if (!parent || parent.scenarioId !== scenarioId) {
        return NextResponse.json(
          { error: "Parent group not found in this scenario" },
          { status: 400 },
        );
      }
      if (parent.requiresGroupId !== null) {
        return NextResponse.json(
          { error: "v1 supports only one level of dependency" },
          { status: 400 },
        );
      }
    }

    // Pick the audit action: rename wins, then set_required, then set_default.
    // Multiple-field PATCHes are allowed but rare — picking a single action
    // keeps the audit log scannable. Metadata carries the full body so the
    // exact change is recoverable.
    let action: AuditAction;
    if (body.name !== undefined) {
      action = "toggle_group.rename";
    } else if (body.requiresGroupId !== undefined) {
      action = "toggle_group.set_required";
    } else if (body.defaultOn !== undefined) {
      action = "toggle_group.set_default";
    } else {
      // Empty body — nothing to do. Treat as 400 to surface UI bugs early.
      return NextResponse.json(
        { error: "PATCH body must include at least one field" },
        { status: 400 },
      );
    }

    // Build the update set from only the fields the client sent. Drizzle's
    // `.set` ignores undefined keys, but being explicit avoids accidentally
    // wiping a column with a future zod schema change.
    const updates: Partial<typeof scenarioToggleGroups.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.name !== undefined) updates.name = body.name;
    if (body.defaultOn !== undefined) updates.defaultOn = body.defaultOn;
    if (body.requiresGroupId !== undefined) {
      updates.requiresGroupId = body.requiresGroupId;
    }

    await db
      .update(scenarioToggleGroups)
      .set(updates)
      .where(eq(scenarioToggleGroups.id, groupId));

    await recordAudit({
      action,
      resourceType: "toggle_group",
      resourceId: groupId,
      clientId,
      firmId,
      metadata: { scenarioId, groupId, ...body },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "PATCH /api/clients/[id]/scenarios/[sid]/toggle-groups/[gid] error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId, gid: groupId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    // Verify gid belongs to sid.
    const [group] = await db
      .select({ id: scenarioToggleGroups.id })
      .from(scenarioToggleGroups)
      .where(
        and(
          eq(scenarioToggleGroups.id, groupId),
          eq(scenarioToggleGroups.scenarioId, scenarioId),
        ),
      );
    if (!group) {
      return NextResponse.json(
        { error: "Toggle group not found" },
        { status: 404 },
      );
    }

    // Parse the moveChangesTo query param. The URL is always present on
    // NextRequest, but `req.url` is the safer surface for tests passing a
    // plain Request.
    const url = new URL(req.url);
    const queryParsed = DELETE_QUERY.safeParse({
      moveChangesTo: url.searchParams.get("moveChangesTo") ?? undefined,
    });
    if (!queryParsed.success) {
      return NextResponse.json(
        { error: queryParsed.error.flatten() },
        { status: 400 },
      );
    }
    const { moveChangesTo } = queryParsed.data;

    // Three statements (reassign-or-delete-changes, then delete group) wrapped
    // in a transaction — keeps the per-row state consistent if a tab-close /
    // network drop interrupts mid-flight.
    await db.transaction(async (tx) => {
      if (moveChangesTo === "ungrouped") {
        await tx
          .update(scenarioChanges)
          .set({ toggleGroupId: null, updatedAt: new Date() })
          .where(
            and(
              eq(scenarioChanges.scenarioId, scenarioId),
              eq(scenarioChanges.toggleGroupId, groupId),
            ),
          );
      } else {
        await tx
          .delete(scenarioChanges)
          .where(
            and(
              eq(scenarioChanges.scenarioId, scenarioId),
              eq(scenarioChanges.toggleGroupId, groupId),
            ),
          );
      }
      await tx
        .delete(scenarioToggleGroups)
        .where(eq(scenarioToggleGroups.id, groupId));
    });

    await recordAudit({
      action: "toggle_group.delete",
      resourceType: "toggle_group",
      resourceId: groupId,
      clientId,
      firmId,
      metadata: { scenarioId, groupId, moveChangesTo },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "DELETE /api/clients/[id]/scenarios/[sid]/toggle-groups/[gid] error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
