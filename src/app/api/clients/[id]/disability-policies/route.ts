import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { createDisabilityPolicyForClient } from "@/lib/clients/disability-policies-writes";
import {
  loadDisabilityPolicies,
  rowToDisabilityPolicy,
} from "@/lib/insurance-policies/load-disability-policies";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/disability-policies
// Disability policies are client-level (like life insurance), so there is no
// scenario lookup here.
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

    return NextResponse.json({ policies: await loadDisabilityPolicies(id) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/disability-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/disability-policies
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await createDisabilityPolicyForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { policy: rowToDisabilityPolicy(result.data) },
      { status: 201 },
    );
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/disability-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
