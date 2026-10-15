import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { disabilityPolicies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { updateDisabilityPolicyForClient } from "@/lib/clients/disability-policies-writes";
import { rowToDisabilityPolicy } from "@/lib/insurance-policies/load-disability-policies";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/disability-policies/[policyId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await updateDisabilityPolicyForClient({
      clientId: id,
      firmId,
      policyId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }

    return NextResponse.json({ policy: rowToDisabilityPolicy(result.data) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PATCH /api/clients/[id]/disability-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/disability-policies/[policyId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // Same in-query scoping as PATCH — an empty `.returning()` is a 404.
    const [row] = await db
      .delete(disabilityPolicies)
      .where(
        and(
          eq(disabilityPolicies.id, policyId),
          eq(disabilityPolicies.clientId, id),
        ),
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await recordAudit({
      action: "disability_policy.delete",
      resourceType: "disability_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: row.name }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/disability-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
