import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import { clients, clientDeductions } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

async function ownsDeduction(clientId: string, deductionId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

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
    const firmId = await getOrgId();
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
    const firmId = await getOrgId();
    const { id, deductionId } = await params;

    if (!(await ownsDeduction(id, deductionId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(clientDeductions)
      .where(and(eq(clientDeductions.id, deductionId), eq(clientDeductions.clientId, id)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/deductions/[deductionId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
