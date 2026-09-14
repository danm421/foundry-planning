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
//          state. Deletes the notes_receivable rows this scenario's toggle
//          groups gated FIRST — see the comment on the delete itself.
//
// Auth model (Task 17d): `requireOrgAndUser` for callerOrg (audit actor) +
// `requireClientEditAccess` for firmId (OWNING) and edit-permission gate.
// This closes the pre-existing edit gap where `assertScenarioRouteScope`
// had no permission check of its own. VIEW recipients now get 403.
// `assertScenarioRouteScope` receives the OWNING firmId so cross-org
// shared-edit recipients pass the `a.firmId === firmId` check inside it.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notesReceivable, scenarios, scenarioToggleGroups } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createScenarioWithClone } from "@/lib/scenario/create-with-clone";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";

export const dynamic = "force-dynamic";

const PATCH_BODY = z.object({
  name: z.string().min(1).max(60).regex(/\S/, "name must not be empty"),
});

type RouteCtx = { params: Promise<{ id: string; sid: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { id: clientId, sid: scenarioId } = await ctx.params;
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

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
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: parsed.data.name }),
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
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { id: clientId, sid: scenarioId } = await ctx.params;
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

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
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        sourceScenarioId: scenarioId,
        name: created.name,
      }),
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
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { id: clientId, sid: scenarioId } = await ctx.params;
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

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

    // A solver sale-to-trust writes its promissory note on the client's BASE
    // partition, gated by a toggle group THIS scenario owns — the documented
    // shape `resolveToggleGatedNotesOnBase` assumes on promote. Deleting the
    // scenario cascades the toggle group away, and `notes_receivable.
    // toggle_group_id` is ON DELETE SET NULL, so the note would survive with a
    // NULL gate. An ungated note on the base partition is "the base plan's,
    // always visible" by the loader's own rule — so deleting a what-if would
    // write a promissory note into the client's REAL plan, permanently, and
    // inflate the in-estate net worth the Net Worth page displays.
    //
    // Scoped to this client as well as to this scenario's own groups: a toggle
    // group is already scenario-owned, so the client predicate is redundant by
    // construction and kept as the same defence the rest of the write path uses.
    // Children (note_receivable_owners, note_extra_payments) cascade.
    const ungatedNotes = await db.transaction(async (tx) => {
      const groups = await tx
        .select({ id: scenarioToggleGroups.id })
        .from(scenarioToggleGroups)
        .where(eq(scenarioToggleGroups.scenarioId, scenarioId));
      let deleted = 0;
      if (groups.length > 0) {
        const removed = await tx
          .delete(notesReceivable)
          .where(
            and(
              eq(notesReceivable.clientId, clientId),
              inArray(
                notesReceivable.toggleGroupId,
                groups.map((g) => g.id),
              ),
            ),
          )
          .returning({ id: notesReceivable.id });
        deleted = removed.length;
      }
      await tx.delete(scenarios).where(eq(scenarios.id, scenarioId));
      return deleted;
    });

    await recordAudit({
      action: "scenario.delete",
      resourceType: "scenario",
      resourceId: scenarioId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        name: scope.scenario.name,
        gatedNotesDeleted: ungatedNotes,
      }),
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
