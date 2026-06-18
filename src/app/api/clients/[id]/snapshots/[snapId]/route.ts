// src/app/api/clients/[id]/snapshots/[snapId]/route.ts
//
// GET    → read a single snapshot row (includes both frozen effective trees
//          + toggle state). Firm scoping flows via clients.firmId since
//          scenario_snapshots has no firmId column.
// DELETE → hard-delete the snapshot row. Per spec §3.1 snapshots are
//          designed to outlive the source scenario, but user-initiated
//          deletes are still allowed (this is the only sanctioned path).
//
// Auth model (Task 17d — DELETE): `requireOrgAndUser` + `requireClientEditAccess`
// for owning firmId and edit-permission gate. Replaces old verifyClientAccess.
// `requireActiveSubscriptionForFirm(firmId)` gates on the OWNING firm's sub.
// Client-not-found now collapses to 403 (uniform denial).
// GET retains `verifyClientAccess` (read-only).
//
// Security: every miss — bad client id, cross-firm probe, or snapshot under
// a different client — returns 404 to avoid leaking the existence of foreign
// snapshot ids. Same shape as `scenarios/[sid]/route.ts`.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { scenarioSnapshots } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; snapId: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId, snapId } = await ctx.params;

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 },
      );
    }

    // Constrain by both `id` AND `clientId` so a snapshot id from another
    // client (even within the same firm) doesn't leak across the URL boundary.
    const [row] = await db
      .select()
      .from(scenarioSnapshots)
      .where(
        and(
          eq(scenarioSnapshots.id, snapId),
          eq(scenarioSnapshots.clientId, clientId),
        ),
      );
    if (!row) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ snapshot: row });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("GET /api/clients/[id]/snapshots/[snapId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId, snapId } = await ctx.params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    // Same id+clientId pair on the lookup so the existence check enforces the
    // same scoping rule the GET does.
    const [target] = await db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
      })
      .from(scenarioSnapshots)
      .where(
        and(
          eq(scenarioSnapshots.id, snapId),
          eq(scenarioSnapshots.clientId, clientId),
        ),
      );
    if (!target) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 },
      );
    }

    await db
      .delete(scenarioSnapshots)
      .where(eq(scenarioSnapshots.id, snapId));

    await recordAudit({
      action: "snapshot.delete",
      resourceType: "scenario_snapshot",
      resourceId: snapId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        name: target.name,
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("DELETE /api/clients/[id]/snapshots/[snapId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
