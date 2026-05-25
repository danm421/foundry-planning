import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, medicareCoverage } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { rowToMedicareCoverage, medicareCoverageToInsert } from "@/lib/medicare/dbMapper";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(medicareCoverage)
      .where(eq(medicareCoverage.clientId, id));
    return NextResponse.json(rows.map(rowToMedicareCoverage));
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/medicare-coverage error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    if (body?.owner !== "client" && body?.owner !== "spouse") {
      return NextResponse.json({ error: "owner must be 'client' or 'spouse'" }, { status: 400 });
    }

    const insert = medicareCoverageToInsert(body, id);

    await db
      .insert(medicareCoverage)
      .values(insert)
      .onConflictDoUpdate({
        target: [medicareCoverage.clientId, medicareCoverage.owner],
        set: {
          enrollmentYear: insert.enrollmentYear,
          coverageType: insert.coverageType,
          medigapMonthlyAt65: insert.medigapMonthlyAt65,
          partDPlanMonthlyAt65: insert.partDPlanMonthlyAt65,
          priorYearMagi: insert.priorYearMagi,
          updatedAt: new Date(),
        },
      });

    await recordAudit({
      action: "medicare_coverage.upsert",
      resourceType: "medicare_coverage",
      resourceId: `${id}:${body.owner}`,
      clientId: id,
      firmId,
      metadata: { owner: body.owner },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/medicare-coverage error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
