// src/app/api/clients/[id]/ltc-policies/[policyId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ltcPolicies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { updateLtcPolicyForClient } from "@/lib/clients/ltc-policies-writes";
import { rowToLtcPolicy } from "@/lib/insurance-policies/load-ltc-policies";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

const scoped = (id: string, policyId: string) =>
  and(eq(ltcPolicies.id, policyId), eq(ltcPolicies.clientId, id));

// PATCH /api/clients/[id]/ltc-policies/[policyId] — the merged-record rules live in the core.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await updateLtcPolicyForClient({
      clientId: id,
      firmId,
      policyId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }

    return NextResponse.json({ policy: rowToLtcPolicy(result.data) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/ltc-policies/[policyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/ltc-policies/[policyId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [row] = await db.delete(ltcPolicies).where(scoped(id, policyId)).returning();
    if (!row) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await recordAudit({
      action: "ltc_policy.delete",
      resourceType: "ltc_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: row.name }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/ltc-policies/[policyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
