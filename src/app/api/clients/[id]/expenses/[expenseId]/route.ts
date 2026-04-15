import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, expenses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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
    const { type, name, annualAmount, startYear, endYear, growthRate, ownerEntityId } = body;

    const [updated] = await db
      .update(expenses)
      .set({
        ...(type !== undefined && { type }),
        ...(name !== undefined && { name }),
        ...(annualAmount !== undefined && { annualAmount }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(growthRate !== undefined && { growthRate }),
        ...(ownerEntityId !== undefined && { ownerEntityId: ownerEntityId ?? null }),
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
