// src/app/api/clients/[id]/scenarios/[sid]/changes/route.ts
//
// Unified writer route for scenario_changes rows. POST handles edit/add/remove
// (discriminated by `op`), DELETE handles revert (kind/target/op via search
// params). Wraps the four exports from `@/lib/scenario/changes-writer` —
// `applyEntityEdit`, `applyEntityAdd`, `applyEntityRemove`, `revertChange` —
// each of which already enforces firmId-on-scenario via `assertScenarioInFirm`.
//
// We additionally check `clientId` matches the scenario at the route layer so
// a request like `/api/clients/<other-firm-client>/scenarios/<my-scenario>/...`
// returns a clear 404 instead of a misleading 403 from the writer.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarioToggleGroups, scenarios } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  TARGET_KIND_TO_FIELD,
  SINGLETON_KIND_TO_FIELD,
} from "@/engine/scenario/applyChanges";
import {
  applyEntityAdd,
  applyEntityEdit,
  applyEntityRemove,
  revertChange,
} from "@/lib/scenario/changes-writer";
import type { OpType, TargetKind } from "@/engine/scenario/types";

// All writable TargetKind values, derived from the runtime lookup maps so the
// route enum stays in sync with applyChanges automatically. Unknown strings are
// rejected here with a 400 before they ever reach the writer (which would
// otherwise throw and surface as a 500).
const WRITABLE_TARGET_KINDS = [
  ...Object.keys(TARGET_KIND_TO_FIELD),
  ...Object.keys(SINGLETON_KIND_TO_FIELD),
].filter((v, i, a) => a.indexOf(v) === i) as [TargetKind, ...TargetKind[]];

export const dynamic = "force-dynamic";

const POST_BODY = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("edit"),
    targetKind: z.enum(WRITABLE_TARGET_KINDS),
    targetId: z.string().uuid(),
    desiredFields: z.record(z.string(), z.unknown()),
    toggleGroupId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal("add"),
    targetKind: z.enum(WRITABLE_TARGET_KINDS),
    // entity must carry an `id` (the writer treats it as the targetId).
    entity: z
      .record(z.string(), z.unknown())
      .refine((e) => typeof e.id === "string" && e.id.length > 0, {
        message: "entity.id is required",
      }),
    toggleGroupId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal("remove"),
    targetKind: z.enum(WRITABLE_TARGET_KINDS),
    targetId: z.string().uuid(),
    toggleGroupId: z.string().uuid().nullable().optional(),
  }),
]);

const OP_TYPES = ["add", "edit", "remove"] as const;

type RouteCtx = { params: Promise<{ id: string; sid: string }> };

/**
 * Asserts the scenario belongs to the client AND the client belongs to the
 * firm. Returns null on success, or a NextResponse to short-circuit on miss
 * (404). The writer's `assertScenarioInFirm` would 403 on cross-firm access,
 * but we want a 404 here so a leaked scenario id can't be probed.
 *
 * Two queries (client→firm, scenario→client). The cost is acceptable for v1
 * (single-digit ms on Neon). Could be collapsed into a single join later.
 */
async function assertRouteScope(
  clientId: string,
  scenarioId: string,
): Promise<NextResponse | null> {
  const access = await verifyClientAccess(clientId);
  if (!access.ok) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (access.permission !== "edit") {
    return NextResponse.json({ error: "View-only access" }, { status: 403 });
  }
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)));
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  return null;
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scopeError = await assertRouteScope(clientId, scenarioId);
    if (scopeError) return scopeError;

    const parsed = POST_BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // When the change is assigned to a toggle group, verify the group belongs
    // to this scenario. 400 (not 404) mirrors the [cid] PATCH posture — the
    // request shape is valid, we just refuse a cross-scenario group id (which
    // would otherwise satisfy the FK but be silently dropped at report time).
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

    switch (body.op) {
      case "edit": {
        await applyEntityEdit({
          scenarioId,
          firmId,
          targetKind: body.targetKind as TargetKind,
          targetId: body.targetId,
          desiredFields: body.desiredFields,
          toggleGroupId: body.toggleGroupId ?? null,
        });
        await recordAudit({
          action: "scenario_change.upsert",
          resourceType: "scenario_change",
          resourceId: scenarioId,
          clientId,
          firmId,
          metadata: { op: "edit", targetKind: body.targetKind, targetId: body.targetId },
        });
        return NextResponse.json({ ok: true });
      }
      case "add": {
        const { targetId } = await applyEntityAdd({
          scenarioId,
          firmId,
          targetKind: body.targetKind as TargetKind,
          // The Zod refine above guarantees entity.id is a non-empty string;
          // cast for the writer's `BaseEntity` shape.
          entity: body.entity as { id: string } & Record<string, unknown>,
          toggleGroupId: body.toggleGroupId ?? null,
        });
        await recordAudit({
          action: "scenario_change.upsert",
          resourceType: "scenario_change",
          resourceId: scenarioId,
          clientId,
          firmId,
          metadata: { op: "add", targetKind: body.targetKind, targetId },
        });
        return NextResponse.json({ ok: true, targetId });
      }
      case "remove": {
        await applyEntityRemove({
          scenarioId,
          firmId,
          targetKind: body.targetKind as TargetKind,
          targetId: body.targetId,
          toggleGroupId: body.toggleGroupId ?? null,
        });
        await recordAudit({
          action: "scenario_change.upsert",
          resourceType: "scenario_change",
          resourceId: scenarioId,
          clientId,
          firmId,
          metadata: { op: "remove", targetKind: body.targetKind, targetId: body.targetId },
        });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/scenarios/[sid]/changes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scopeError = await assertRouteScope(clientId, scenarioId);
    if (scopeError) return scopeError;

    const url = new URL(req.url);
    const targetKind = url.searchParams.get("kind");
    const targetId = url.searchParams.get("target");
    const opTypeRaw = url.searchParams.get("op");

    if (!targetKind || !targetId || !opTypeRaw) {
      return NextResponse.json(
        { error: "missing kind/target/op" },
        { status: 400 },
      );
    }
    if (!(WRITABLE_TARGET_KINDS as readonly string[]).includes(targetKind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${WRITABLE_TARGET_KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!(OP_TYPES as readonly string[]).includes(opTypeRaw)) {
      return NextResponse.json(
        { error: `op must be one of ${OP_TYPES.join("/")}` },
        { status: 400 },
      );
    }
    const opType = opTypeRaw as OpType;

    await revertChange({
      scenarioId,
      firmId,
      targetKind: targetKind as TargetKind,
      targetId,
      opType,
    });
    await recordAudit({
      action: "scenario_change.revert",
      resourceType: "scenario_change",
      resourceId: scenarioId,
      clientId,
      firmId,
      metadata: { op: opType, targetKind, targetId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("DELETE /api/clients/[id]/scenarios/[sid]/changes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
