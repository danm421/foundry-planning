import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientDeductions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function ownsDeduction(clientId: string, deductionId: string): Promise<boolean> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;

  const [row] = await db
    .select()
    .from(clientDeductions)
    .where(and(eq(clientDeductions.id, deductionId), eq(clientDeductions.clientId, clientId)));
  return !!row;
}

// PUT /api/clients/[id]/deductions/[deductionId] — update a deduction
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deductionId: string }> }
) {
  try {
    const { id, deductionId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await ownsDeduction(id, deductionId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      type,
      name,
      owner,
      annualAmount,
      growthRate,
      startYear,
      endYear,
      startYearRef,
      endYearRef,
    } = body;

    const [updated] = await db
      .update(clientDeductions)
      .set({
        type: type ?? undefined,
        name: name !== undefined ? name : undefined,
        owner: owner ?? undefined,
        annualAmount: annualAmount != null ? String(annualAmount) : undefined,
        growthRate: growthRate != null ? String(growthRate) : undefined,
        startYear: startYear ?? undefined,
        endYear: endYear ?? undefined,
        startYearRef: startYearRef !== undefined ? startYearRef : undefined,
        endYearRef: endYearRef !== undefined ? endYearRef : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(clientDeductions.id, deductionId), eq(clientDeductions.clientId, id)))
      .returning();

    await recordAudit({
      action: "deduction.update",
      resourceType: "deduction",
      resourceId: deductionId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { type: updated.type, name: updated.name ?? null }),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/deductions/[deductionId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/deductions/[deductionId] — delete a deduction
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; deductionId: string }> }
) {
  try {
    const { id, deductionId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await ownsDeduction(id, deductionId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(clientDeductions)
        .where(and(eq(clientDeductions.id, deductionId), eq(clientDeductions.clientId, id)));
      await pruneOrphanScenarioChanges(tx, deductionId);
    });

    await recordAudit({
      action: "deduction.delete",
      resourceType: "deduction",
      resourceId: deductionId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/deductions/[deductionId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
