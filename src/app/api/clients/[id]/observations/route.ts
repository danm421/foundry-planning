import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { planObservations } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { observationCreateSchema } from "@/lib/schemas/observations";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(planObservations)
      .where(eq(planObservations.clientId, id))
      .orderBy(
        asc(planObservations.section),
        asc(planObservations.sortOrder),
        asc(planObservations.createdAt),
      );

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/observations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(observationCreateSchema, request);
    if (!parsed.ok) return parsed.response;

    // sortOrder = current max within (clientId, section) + 1, or 0 when empty.
    const [top] = await db
      .select({ sortOrder: planObservations.sortOrder })
      .from(planObservations)
      .where(
        and(
          eq(planObservations.clientId, id),
          eq(planObservations.section, parsed.data.section),
        ),
      )
      .orderBy(desc(planObservations.sortOrder))
      .limit(1);
    const nextSortOrder = top ? top.sortOrder + 1 : 0;

    const [row] = await db
      .insert(planObservations)
      .values({
        clientId: id,
        section: parsed.data.section,
        source: parsed.data.source,
        topic: parsed.data.topic,
        title: parsed.data.title ?? null,
        body: parsed.data.body,
        owner: parsed.data.owner ?? null,
        priority: parsed.data.priority ?? null,
        targetDate: parsed.data.targetDate ?? null,
        sortOrder: nextSortOrder,
      })
      .returning();

    await recordAudit({
      action: "plan_observation.create",
      resourceType: "plan_observation",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        section: row.section,
        topic: row.topic,
      }),
    });

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/observations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
