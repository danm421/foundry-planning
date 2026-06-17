import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  updateIncomeForClient,
  deleteIncomeForClient,
} from "@/lib/clients/incomes-writes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/incomes/[incomeId] — update income
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; incomeId: string }> }
) {
  try {
    const { id, incomeId } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await updateIncomeForClient({
      clientId: id,
      firmId,
      actorId: userId,
      incomeId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/incomes/[incomeId] — delete income
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; incomeId: string }> }
) {
  try {
    const { id, incomeId } = await params;
    const { userId, orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await deleteIncomeForClient({
      clientId: id,
      firmId,
      actorId: userId,
      incomeId,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
