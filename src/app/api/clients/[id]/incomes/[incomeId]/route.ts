import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, incomes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient, assertEntitiesInClient } from "@/lib/db-scoping";

export const dynamic = "force-dynamic";

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
    const firmId = await requireOrgId();
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
      growthSource,
      owner,
      claimingAge,
      linkedEntityId,
      ownerEntityId,
      cashAccountId,
      inflationStartYear,
    } = body;

    if (linkedEntityId !== undefined || ownerEntityId !== undefined) {
      const c = await assertEntitiesInClient(id, [linkedEntityId, ownerEntityId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }
    if (cashAccountId !== undefined) {
      const c = await assertAccountsInClient(id, [cashAccountId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }

    const [updated] = await db
      .update(incomes)
      .set({
        ...(type !== undefined && { type }),
        ...(name !== undefined && { name }),
        ...(annualAmount !== undefined && { annualAmount }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(growthRate !== undefined && { growthRate }),
        ...(growthSource !== undefined && { growthSource: growthSource === "inflation" ? "inflation" : "custom" }),
        ...(owner !== undefined && { owner }),
        ...(claimingAge !== undefined && { claimingAge: claimingAge ? Number(claimingAge) : null }),
        ...(linkedEntityId !== undefined && { linkedEntityId: linkedEntityId ?? null }),
        ...(ownerEntityId !== undefined && { ownerEntityId: ownerEntityId ?? null }),
        ...(cashAccountId !== undefined && { cashAccountId: cashAccountId ?? null }),
        ...(inflationStartYear !== undefined && {
          inflationStartYear: inflationStartYear == null ? null : Number(inflationStartYear),
        }),
        ...(body.startYearRef !== undefined && { startYearRef: body.startYearRef }),
        ...(body.endYearRef !== undefined && { endYearRef: body.endYearRef }),
        ...(body.ssBenefitMode !== undefined && { ssBenefitMode: body.ssBenefitMode ?? null }),
        ...(body.piaMonthly !== undefined && { piaMonthly: body.piaMonthly != null ? String(body.piaMonthly) : null }),
        ...(body.claimingAgeMonths !== undefined && { claimingAgeMonths: body.claimingAgeMonths != null ? Number(body.claimingAgeMonths) : 0 }),
        ...(body.claimingAgeMode !== undefined && { claimingAgeMode: body.claimingAgeMode }),
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
    const firmId = await requireOrgId();
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
