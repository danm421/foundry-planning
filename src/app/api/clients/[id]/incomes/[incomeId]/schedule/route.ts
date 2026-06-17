import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { incomes, incomeScheduleOverrides } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; incomeId: string }> };

async function verifyOwnership(clientId: string, incomeId: string) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;

  const [inc] = await db
    .select()
    .from(incomes)
    .where(and(eq(incomes.id, incomeId), eq(incomes.clientId, clientId)));
  return !!inc;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id, incomeId } = await params;

    if (!(await verifyOwnership(id, incomeId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select({ year: incomeScheduleOverrides.year, amount: incomeScheduleOverrides.amount })
      .from(incomeScheduleOverrides)
      .where(eq(incomeScheduleOverrides.incomeId, incomeId));

    return NextResponse.json(
      rows.map((r) => ({ year: r.year, amount: parseFloat(r.amount) }))
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET income schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id, incomeId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyOwnership(id, incomeId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const overrides: { year: number; amount: number }[] = body.overrides ?? [];

    await db
      .delete(incomeScheduleOverrides)
      .where(eq(incomeScheduleOverrides.incomeId, incomeId));

    if (overrides.length > 0) {
      await db.insert(incomeScheduleOverrides).values(
        overrides.map((o) => ({
          incomeId,
          year: o.year,
          amount: String(o.amount),
        }))
      );
    }

    await recordAudit({
      action: "income.schedule.update",
      resourceType: "income",
      resourceId: incomeId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { count: overrides.length }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT income schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id, incomeId } = await params;
    await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyOwnership(id, incomeId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(incomeScheduleOverrides)
      .where(eq(incomeScheduleOverrides.incomeId, incomeId));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE income schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
