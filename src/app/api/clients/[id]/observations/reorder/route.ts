import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { planObservations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { observationReorderSchema } from "@/lib/schemas/observations";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(observationReorderSchema, request);
    if (!parsed.ok) return parsed.response;

    const rows = await db
      .select({ id: planObservations.id })
      .from(planObservations)
      .where(
        and(
          eq(planObservations.clientId, id),
          eq(planObservations.section, parsed.data.section),
        ),
      );
    const known = new Set(rows.map((r) => r.id));
    if (
      parsed.data.orderedIds.length !== known.size ||
      parsed.data.orderedIds.some((x) => !known.has(x))
    ) {
      return NextResponse.json({ error: "Stale order" }, { status: 400 });
    }

    await Promise.all(
      parsed.data.orderedIds.map((oid, i) =>
        db
          .update(planObservations)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(planObservations.id, oid),
              eq(planObservations.clientId, id),
            ),
          ),
      ),
    );

    await recordAudit({
      action: "plan_observation.reorder",
      resourceType: "plan_observation",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        section: parsed.data.section,
        count: parsed.data.orderedIds.length,
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/observations/reorder error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
