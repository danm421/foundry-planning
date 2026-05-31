import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, expenses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertAccountsInClient,
  assertBusinessAccountsInClient,
  assertEntitiesInClient,
} from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";

export const dynamic = "force-dynamic";

async function verifyClientAccess(clientId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

// PUT /api/clients/[id]/expenses/[expenseId] — update expense
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, expenseId } = await params;

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
      ownerEntityId,
      ownerAccountId,
      cashAccountId,
      inflationStartYear,
      endsAtMedicareEligibilityOwner,
    } = body;

    if (
      endsAtMedicareEligibilityOwner !== undefined &&
      endsAtMedicareEligibilityOwner != null &&
      endsAtMedicareEligibilityOwner !== "client" &&
      endsAtMedicareEligibilityOwner !== "spouse"
    ) {
      return NextResponse.json(
        { error: "endsAtMedicareEligibilityOwner must be 'client', 'spouse', or null" },
        { status: 400 },
      );
    }

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
      .update(expenses)
      .set({
        ...(type !== undefined && { type }),
        ...(name !== undefined && { name }),
        ...(annualAmount !== undefined && { annualAmount }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(growthRate !== undefined && { growthRate }),
        ...(growthSource !== undefined && { growthSource: growthSource === "inflation" ? "inflation" : "custom" }),
        ...(ownerEntityId !== undefined && { ownerEntityId: ownerEntityId ?? null }),
        ...(ownerAccountId !== undefined && { ownerAccountId: ownerAccountId ?? null }),
        ...(cashAccountId !== undefined && { cashAccountId: cashAccountId ?? null }),
        ...(inflationStartYear !== undefined && {
          inflationStartYear: inflationStartYear == null ? null : Number(inflationStartYear),
        }),
        ...(body.startYearRef !== undefined && { startYearRef: body.startYearRef }),
        ...(body.endYearRef !== undefined && { endYearRef: body.endYearRef }),
        ...(body.deductionType !== undefined && { deductionType: body.deductionType }),
        ...(endsAtMedicareEligibilityOwner !== undefined && {
          endsAtMedicareEligibilityOwner: endsAtMedicareEligibilityOwner ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    await recordAudit({
      action: "expense.update",
      resourceType: "expense",
      resourceId: expenseId,
      clientId: id,
      firmId,
      metadata: { type: updated.type, name: updated.name },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/expenses/[expenseId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/expenses/[expenseId] — delete expense
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, expenseId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Protect the seeded current/retirement living-expense rows — every client needs them.
    const [target] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, id)));
    if (target?.isDefault) {
      return NextResponse.json(
        { error: "Default living-expense rows cannot be deleted." },
        { status: 400 }
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, id)));
      await pruneOrphanScenarioChanges(tx, expenseId);
    });

    await recordAudit({
      action: "expense.delete",
      resourceType: "expense",
      resourceId: expenseId,
      clientId: id,
      firmId,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/expenses/[expenseId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
