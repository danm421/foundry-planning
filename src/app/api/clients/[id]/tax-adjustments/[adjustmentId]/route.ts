import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientTaxAdjustments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function ownsTaxAdjustment(clientId: string, adjustmentId: string): Promise<boolean> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;

  const [row] = await db
    .select()
    .from(clientTaxAdjustments)
    .where(and(eq(clientTaxAdjustments.id, adjustmentId), eq(clientTaxAdjustments.clientId, clientId)));
  return !!row;
}

// PUT /api/clients/[id]/tax-adjustments/[adjustmentId] — update a tax adjustment
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; adjustmentId: string }> }
) {
  try {
    const { id, adjustmentId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await ownsTaxAdjustment(id, adjustmentId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      taxType,
      name,
      owner,
      annualAmount,
      growthRate,
      startYear,
      endYear,
      startYearRef,
      endYearRef,
      withheldMode,
      withheldValue,
    } = body;

    const [updated] = await db
      .update(clientTaxAdjustments)
      .set({
        taxType: taxType ?? undefined,
        name: name !== undefined ? name : undefined,
        owner: owner ?? undefined,
        annualAmount: annualAmount != null ? String(annualAmount) : undefined,
        growthRate: growthRate != null ? String(growthRate) : undefined,
        startYear: startYear ?? undefined,
        endYear: endYear ?? undefined,
        startYearRef: startYearRef !== undefined ? startYearRef : undefined,
        endYearRef: endYearRef !== undefined ? endYearRef : undefined,
        withheldMode: withheldMode ?? undefined,
        withheldValue: withheldValue != null ? String(withheldValue) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(clientTaxAdjustments.id, adjustmentId), eq(clientTaxAdjustments.clientId, id)))
      .returning();

    await recordAudit({
      action: "tax_adjustment.update",
      resourceType: "tax_adjustment",
      resourceId: adjustmentId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { taxType: updated.taxType, name: updated.name ?? null }),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/tax-adjustments/[adjustmentId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/tax-adjustments/[adjustmentId] — delete a tax adjustment
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; adjustmentId: string }> }
) {
  try {
    const { id, adjustmentId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await ownsTaxAdjustment(id, adjustmentId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(clientTaxAdjustments)
        .where(and(eq(clientTaxAdjustments.id, adjustmentId), eq(clientTaxAdjustments.clientId, id)));
      await pruneOrphanScenarioChanges(tx, adjustmentId);
    });

    await recordAudit({
      action: "tax_adjustment.delete",
      resourceType: "tax_adjustment",
      resourceId: adjustmentId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/tax-adjustments/[adjustmentId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
