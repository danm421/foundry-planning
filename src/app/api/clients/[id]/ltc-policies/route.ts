// src/app/api/clients/[id]/ltc-policies/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { createLtcPolicyForClient } from "@/lib/clients/ltc-policies-writes";
import { loadLtcPolicies, rowToLtcPolicy } from "@/lib/insurance-policies/load-ltc-policies";
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

    const result = await createLtcPolicyForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }

    return NextResponse.json({ policy: rowToLtcPolicy(result.data) }, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/ltc-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
