import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawalStrategies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/withdrawal-strategy/[strategyId] — update withdrawal strategy
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; strategyId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, strategyId } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
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

    await recordAudit({
      action: "withdrawal_strategy.update",
      resourceType: "withdrawal_strategy",
      resourceId: strategyId,
      clientId: id,
      firmId,
      metadata: { accountId: updated.accountId, priorityOrder: updated.priorityOrder },
    });

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
    const firmId = await requireOrgId();
    const { id, strategyId } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(withdrawalStrategies)
        .where(and(eq(withdrawalStrategies.id, strategyId), eq(withdrawalStrategies.clientId, id)));
      await pruneOrphanScenarioChanges(tx, strategyId);
    });

    await recordAudit({
      action: "withdrawal_strategy.delete",
      resourceType: "withdrawal_strategy",
      resourceId: strategyId,
      clientId: id,
      firmId,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/withdrawal-strategy/[strategyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
