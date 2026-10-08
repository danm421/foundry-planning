// src/app/api/clients/[id]/ltc-policies/[policyId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { ltcPolicies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import {
  LTC_POLICY_FIELD_KEYS,
  ltcPolicyProblems,
  ltcPolicyUpdateSchema,
} from "@/lib/schemas/ltc-policies";
import { loadRiderLifePolicy, rowToLtcPolicy } from "@/lib/insurance-policies/load-ltc-policies";
import {
  normalizeLtcPolicyFields,
  type LtcPolicyFields,
} from "@/lib/insurance-policies/ltc-policy-fields";
import { ltcFieldsToColumns } from "@/lib/insurance-policies/ltc-policy-row";
import { riderLinkProblem } from "@/lib/insurance-policies/ltc-rider-link";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

const scoped = (id: string, policyId: string) =>
  and(eq(ltcPolicies.id, policyId), eq(ltcPolicies.clientId, id));

// PATCH /api/clients/[id]/ltc-policies/[policyId]
//
// Validates the STORED ROW MERGED WITH THE BODY, not the body alone. A
// body-only check (the disability route's) lets two one-key saves build a row
// a create would refuse — e.g. `{kind:"life_rider"}` on a standalone policy.
// Then it normalizes the merge and writes only the columns that differ from the
// stored row: the sent keys that changed, plus the leftovers a kind switch cleared.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = ltcPolicyUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Tenant isolation lives in the query: another client's id matches nothing.
    const [existing] = await db.select().from(ltcPolicies).where(scoped(id, policyId));
    if (!existing) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }
    const { id: _id, ...stored } = rowToLtcPolicy(existing);
    void _id;
    const merged: LtcPolicyFields = { ...stored };
    for (const [k, v] of Object.entries(d)) {
      if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
    }
    const problems = ltcPolicyProblems(merged);
    if (problems.length > 0) {
      return NextResponse.json({ error: "Invalid body", issues: problems }, { status: 400 });
    }
    if (merged.kind === "life_rider") {
      const problem = riderLinkProblem(
        merged.insured,
        await loadRiderLifePolicy(id, merged.lifePolicyAccountId!),
      );
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const next = normalizeLtcPolicyFields(merged);
    const changed: Partial<LtcPolicyFields> = {};
    for (const key of LTC_POLICY_FIELD_KEYS) {
      if (next[key] !== stored[key]) (changed as Record<string, unknown>)[key] = next[key];
    }

    const [row] = await db
      .update(ltcPolicies)
      .set({ ...ltcFieldsToColumns(changed), updatedAt: new Date() })
      .where(scoped(id, policyId))
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await recordAudit({
      action: "ltc_policy.update",
      resourceType: "ltc_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        name: row.name,
        fieldsChanged: Object.keys(d),
      }),
    });

    return NextResponse.json({ policy: rowToLtcPolicy(row) });
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
