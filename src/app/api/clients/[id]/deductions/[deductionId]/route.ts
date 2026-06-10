import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientDeductions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

async function ownsDeduction(clientId: string, deductionId: string, firmId: string): Promise<boolean> {
  if (!(await verifyClientAccess(clientId, firmId))) return false;

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
    const firmId = await requireOrgId();
    const { id, deductionId } = await params;

    if (!(await ownsDeduction(id, deductionId, firmId))) {
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
      metadata: { type: updated.type, name: updated.name ?? null },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
    const firmId = await requireOrgId();
    const { id, deductionId } = await params;

    if (!(await ownsDeduction(id, deductionId, firmId))) {
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
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/deductions/[deductionId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
