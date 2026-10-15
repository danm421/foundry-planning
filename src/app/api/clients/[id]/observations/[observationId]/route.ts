import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { planObservations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { updateObservationForClient } from "@/lib/clients/observations-writes";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; observationId: string }> },
) {
  try {
    const { id, observationId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const result = await updateObservationForClient({
      clientId: id,
      firmId,
      observationId,
      input,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });

    return NextResponse.json(result.data);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/observations/[observationId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; observationId: string }> },
) {
  try {
    const { id, observationId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [row] = await db
      .delete(planObservations)
      .where(
        and(
          eq(planObservations.id, observationId),
          eq(planObservations.clientId, id),
        ),
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Observation not found" }, { status: 404 });
    }

    await recordAudit({
      action: "plan_observation.delete",
      resourceType: "plan_observation",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/observations/[observationId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
