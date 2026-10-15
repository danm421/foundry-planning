import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  updateInsurancePolicyForClient,
  verifyPolicy,
} from "@/lib/clients/insurance-policies-writes";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/insurance-policies/[policyId] — partial update
// of a life-insurance policy (the underlying account + policy row +
// optional full replacement of the free-form cash-value schedule) —
// updateInsurancePolicyForClient.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // The core repeats this check; here it answers before the body is read.
    if (!(await verifyPolicy(policyId, id))) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const result = await updateInsurancePolicyForClient({
      clientId: id,
      firmId,
      policyId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PATCH /api/clients/[id]/insurance-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/insurance-policies/[policyId]
// Removes the underlying accounts row; FK cascades on
// life_insurance_policies.accountId and life_insurance_cash_value_schedule.policyId
// clean up the dependent rows.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // Tenant-isolation: same guard as PATCH.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, policyId),
          eq(accounts.clientId, id),
          eq(accounts.category, "life_insurance"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, policyId), eq(accounts.clientId, id)));

    await recordAudit({
      action: "insurance_policy.delete",
      resourceType: "insurance_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: target.name ?? null }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/insurance-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
