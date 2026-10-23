import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { assertFamilyMembersInClient } from "@/lib/db-scoping";
import { deleteFamilyMemberInTx, updateFamilyMemberForClient } from "@/lib/clients/family-members-writes";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id, memberId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await updateFamilyMemberForClient({
      clientId: id,
      firmId,
      memberId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/family-members/[memberId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id, memberId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // The cleanup below keys on the bare id, so prove it is this client's first.
    const owned = await assertFamilyMembersInClient(id, [memberId]);
    if (!owned.ok) {
      return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    }

    // The delete also removes the will-recipient rows and scenario changes that
    // point at this family member (audit F13), atomically.
    await db.transaction((tx) => deleteFamilyMemberInTx(tx, id, memberId));

    await recordAudit({
      action: "family_member.delete",
      resourceType: "family_member",
      resourceId: memberId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/family-members/[memberId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
