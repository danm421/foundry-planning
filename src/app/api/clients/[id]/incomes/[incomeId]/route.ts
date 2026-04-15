import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, incomes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

async function verifyClientAccess(clientId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

// PUT /api/clients/[id]/incomes/[incomeId] — update income
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; incomeId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, incomeId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      type,
      name,
      annualAmount,
      startYear,
      endYear,
      growthRate,
      owner,
      claimingAge,
      linkedEntityId,
      ownerEntityId,
      cashAccountId,
      inflationStartYear,
    } = body;

    const [updated] = await db
      .update(incomes)
      .set({
        ...(type !== undefined && { type }),
        ...(name !== undefined && { name }),
        ...(annualAmount !== undefined && { annualAmount }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(growthRate !== undefined && { growthRate }),
        ...(owner !== undefined && { owner }),
        ...(claimingAge !== undefined && { claimingAge: claimingAge ? Number(claimingAge) : null }),
        ...(linkedEntityId !== undefined && { linkedEntityId: linkedEntityId ?? null }),
        ...(ownerEntityId !== undefined && { ownerEntityId: ownerEntityId ?? null }),
        ...(cashAccountId !== undefined && { cashAccountId: cashAccountId ?? null }),
        ...(inflationStartYear !== undefined && {
          inflationStartYear: inflationStartYear == null ? null : Number(inflationStartYear),
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(incomes.id, incomeId), eq(incomes.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Income not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/incomes/[incomeId] — delete income
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; incomeId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, incomeId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db
      .delete(incomes)
      .where(and(eq(incomes.id, incomeId), eq(incomes.clientId, id)));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
