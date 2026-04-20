import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import { clients, expenses } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient, assertEntitiesInClient } from "@/lib/db-scoping";

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
    const firmId = await getOrgId();
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
      cashAccountId,
      inflationStartYear,
    } = body;

    if (ownerEntityId !== undefined) {
      const c = await assertEntitiesInClient(id, [ownerEntityId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
    }
    if (cashAccountId !== undefined) {
      const c = await assertAccountsInClient(id, [cashAccountId]);
      if (!c.ok) return NextResponse.json({ error: c.reason }, { status: 400 });
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
        ...(cashAccountId !== undefined && { cashAccountId: cashAccountId ?? null }),
        ...(inflationStartYear !== undefined && {
          inflationStartYear: inflationStartYear == null ? null : Number(inflationStartYear),
        }),
        ...(body.startYearRef !== undefined && { startYearRef: body.startYearRef }),
        ...(body.endYearRef !== undefined && { endYearRef: body.endYearRef }),
        ...(body.deductionType !== undefined && { deductionType: body.deductionType }),
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

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
    const firmId = await getOrgId();
    const { id, expenseId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db
      .delete(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.clientId, id)));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/expenses/[expenseId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
