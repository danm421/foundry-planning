import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { savingsRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/savings-rules/[ruleId] — update savings rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { id, ruleId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const {
      accountId,
      annualAmount,
      annualPercent,
      rothPercent,
      isDeductible,
      applyContributionLimit,
      contributeMax,
      startYear,
      endYear,
      growthRate,
      growthSource,
      employerMatchPct,
      employerMatchCap,
      employerMatchAmount,
    } = body;

    const [updated] = await db
      .update(savingsRules)
      .set({
        ...(accountId !== undefined && { accountId }),
        ...(annualAmount !== undefined && { annualAmount }),
        ...(annualPercent !== undefined && { annualPercent: annualPercent ?? null }),
        ...(rothPercent !== undefined && {
          rothPercent: rothPercent != null ? String(rothPercent) : null,
        }),
        ...(isDeductible !== undefined && { isDeductible }),
        ...(applyContributionLimit !== undefined && { applyContributionLimit }),
        ...(contributeMax !== undefined && { contributeMax }),
        ...(startYear !== undefined && { startYear: Number(startYear) }),
        ...(endYear !== undefined && { endYear: Number(endYear) }),
        ...(growthRate != null && { growthRate: String(growthRate) }),
        ...(growthSource !== undefined && { growthSource: growthSource === "inflation" ? "inflation" : "custom" }),
        ...(employerMatchPct !== undefined && { employerMatchPct: employerMatchPct ?? null }),
        ...(employerMatchCap !== undefined && { employerMatchCap: employerMatchCap ?? null }),
        ...(employerMatchAmount !== undefined && {
          employerMatchAmount: employerMatchAmount ?? null,
        }),
        ...(body.startYearRef !== undefined && { startYearRef: body.startYearRef }),
        ...(body.endYearRef !== undefined && { endYearRef: body.endYearRef }),
        updatedAt: new Date(),
      })
      .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Savings rule not found" }, { status: 404 });
    }

    await recordAudit({
      action: "savings_rule.update",
      resourceType: "savings_rule",
      resourceId: ruleId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { accountId: updated.accountId }),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/savings-rules/[ruleId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/savings-rules/[ruleId] — delete savings rule
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { id, ruleId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    await db.transaction(async (tx) => {
      await tx
        .delete(savingsRules)
        .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.clientId, id)));
      await pruneOrphanScenarioChanges(tx, ruleId);
    });

    await recordAudit({
      action: "savings_rule.delete",
      resourceType: "savings_rule",
      resourceId: ruleId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/savings-rules/[ruleId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
