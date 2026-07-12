import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { planObservations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { observationUpdateSchema } from "@/lib/schemas/observations";
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

    const parsed = await parseBody(observationUpdateSchema, request);
    if (!parsed.ok) return parsed.response;

    const [existing] = await db
      .select({ status: planObservations.status })
      .from(planObservations)
      .where(
        and(
          eq(planObservations.id, observationId),
          eq(planObservations.clientId, id),
        ),
      );

    if (!existing) {
      return NextResponse.json({ error: "Observation not found" }, { status: 404 });
    }

    // status -> "done" sets completedAt; leaving "done" for any other status
    // clears it. Untouched status (undefined) leaves completedAt as-is.
    const willBeDone = parsed.data.status === "done";
    const leavingDone =
      existing.status === "done" &&
      parsed.data.status !== undefined &&
      parsed.data.status !== "done";

    const [row] = await db
      .update(planObservations)
      .set({
        ...(parsed.data.topic !== undefined && { topic: parsed.data.topic }),
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.body !== undefined && { body: parsed.data.body }),
        ...(parsed.data.owner !== undefined && { owner: parsed.data.owner }),
        ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
        ...(parsed.data.targetDate !== undefined && { targetDate: parsed.data.targetDate }),
        ...(parsed.data.status !== undefined && { status: parsed.data.status }),
        ...(willBeDone && { completedAt: new Date() }),
        ...(leavingDone && { completedAt: null }),
        updatedAt: new Date(),
      })
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
      action: willBeDone ? "plan_observation.complete" : "plan_observation.update",
      resourceType: "plan_observation",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(row);
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
