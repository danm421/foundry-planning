import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, withdrawalStrategies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

async function verifyClientAccess(clientId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

// PUT /api/clients/[id]/withdrawal-strategy/[strategyId] — update withdrawal strategy
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; strategyId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, strategyId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { accountId, priorityOrder, startYear, endYear } = body;

    const [updated] = await db
      .update(withdrawalStrategies)
      .set({
        ...(accountId !== undefined && { accountId }),
        ...(priorityOrder !== undefined && { priorityOrder: Number(priorityOrder) }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(body.startYearRef !== undefined && { startYearRef: body.startYearRef }),
        ...(body.endYearRef !== undefined && { endYearRef: body.endYearRef }),
        updatedAt: new Date(),
      })
      .where(and(eq(withdrawalStrategies.id, strategyId), eq(withdrawalStrategies.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Withdrawal strategy not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/withdrawal-strategy/[strategyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/withdrawal-strategy/[strategyId] — delete withdrawal strategy
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; strategyId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, strategyId } = await params;

    const hasAccess = await verifyClientAccess(id, firmId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db
      .delete(withdrawalStrategies)
      .where(and(eq(withdrawalStrategies.id, strategyId), eq(withdrawalStrategies.clientId, id)));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/withdrawal-strategy/[strategyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
