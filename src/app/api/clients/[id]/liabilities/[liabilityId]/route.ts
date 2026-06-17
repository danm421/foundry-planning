import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  updateLiabilityForClient,
  deleteLiabilityForClient,
} from "@/lib/clients/liabilities-writes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/liabilities/[liabilityId] — update liability
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const { id, liabilityId } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await updateLiabilityForClient({
      clientId: id,
      firmId,
      actorId: userId,
      liabilityId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/liabilities/[liabilityId] — delete liability
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const { id, liabilityId } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await deleteLiabilityForClient({
      clientId: id,
      firmId,
      actorId: userId,
      liabilityId,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
