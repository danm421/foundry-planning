import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, incomes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertAccountsInClient,
  assertBusinessAccountsInClient,
  assertEntitiesInClient,
} from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";

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
      ownerEntityId,
      ownerAccountId,
      cashAccountId,
      inflationStartYear,
    } = body;

    // Reject updates that would leave both ownership fields set. We only fail
    // when both keys appear non-null in the same body — if the client is
    // clearing one and setting the other in the same PUT, that's allowed.
    if (
      ownerEntityId !== undefined &&
      ownerAccountId !== undefined &&
      ownerEntityId != null &&
      ownerAccountId != null
    ) {
      return NextResponse.json(
        { error: "Cannot set both ownerEntityId and ownerAccountId" },
        { status: 400 },
      );
    }

    if (ownerEntityId !== undefined) {
      const c = await assertEntitiesInClient(id, [ownerEntityId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }
    if (cashAccountId !== undefined || ownerAccountId !== undefined) {
      const c = await assertAccountsInClient(id, [
        cashAccountId !== undefined ? cashAccountId : null,
        ownerAccountId !== undefined ? ownerAccountId : null,
      ]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }
    if (ownerAccountId !== undefined && ownerAccountId != null) {
      const b = await assertBusinessAccountsInClient(id, [ownerAccountId]);
      if (!b.ok) return NextResponse.json({ error: b.reason }, { status: 400 });
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
        ...(ownerEntityId !== undefined && { ownerEntityId: ownerEntityId ?? null }),
        ...(ownerAccountId !== undefined && { ownerAccountId: ownerAccountId ?? null }),
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

    await recordAudit({
      action: "income.update",
      resourceType: "income",
      resourceId: incomeId,
      clientId: id,
      firmId,
      metadata: { type: updated.type, name: updated.name },
    });

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

    await recordAudit({
      action: "income.delete",
      resourceType: "income",
      resourceId: incomeId,
      clientId: id,
      firmId,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
