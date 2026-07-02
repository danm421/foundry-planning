import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawalStrategies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { assertAccountsInClient } from "@/lib/db-scoping";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/withdrawal-strategy/[strategyId] — update withdrawal strategy
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; strategyId: string }> }
) {
  try {
    const { id, strategyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const { accountId, priorityOrder, startYear, endYear } = body;

    if (accountId !== undefined) {
      const acctCheck = await assertAccountsInClient(id, [accountId]);
      if (!acctCheck.ok) {
        return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
      }
    }

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
      metadata: crossFirmAuditMeta({ access }, callerOrg, { accountId: updated.accountId, priorityOrder: updated.priorityOrder }),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
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
    const { id, strategyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

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
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/withdrawal-strategy/[strategyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
