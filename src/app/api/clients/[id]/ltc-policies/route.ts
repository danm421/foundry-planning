// src/app/api/clients/[id]/ltc-policies/route.ts
import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { ltcPolicies, type NewLtcPolicyRow } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { ltcPolicyCreateSchema } from "@/lib/schemas/ltc-policies";
import {
  loadLtcPolicies,
  loadRiderLifePolicy,
  rowToLtcPolicy,
} from "@/lib/insurance-policies/load-ltc-policies";
import { normalizeLtcPolicyFields } from "@/lib/insurance-policies/ltc-policy-fields";
import { ltcFieldsFromCreate, ltcFieldsToColumns } from "@/lib/insurance-policies/ltc-policy-row";
import { riderLinkProblem } from "@/lib/insurance-policies/ltc-rider-link";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/ltc-policies — client-level, so no scenario lookup.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json({ policies: await loadLtcPolicies(id) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/ltc-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/ltc-policies
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = ltcPolicyCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const d = parsed.data;

    if (d.kind === "life_rider") {
      const problem = riderLinkProblem(d.insured, await loadRiderLifePolicy(id, d.lifePolicyAccountId!));
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    // Store the normalized row, so a write that did not come from the dialog
    // (Forge, the API) never keeps the other kind's leftovers or a schema
    // default that does not fit the kind.
    const fields = normalizeLtcPolicyFields(ltcFieldsFromCreate(d));
    const [row] = await db
      .insert(ltcPolicies)
      .values({ ...(ltcFieldsToColumns(fields) as NewLtcPolicyRow), clientId: id })
      .returning();

    await recordAudit({
      action: "ltc_policy.create",
      resourceType: "ltc_policy",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: fields.name }),
    });

    return NextResponse.json({ policy: rowToLtcPolicy(row) }, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/ltc-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
