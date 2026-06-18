import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { familyMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { cleanupWillRecipientReferences } from "@/lib/estate/cleanup-will-recipients";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

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

    const body = await request.json();
    const {
      firstName, lastName, relationship, dateOfBirth, notes,
      domesticPartner, inheritanceClassOverride,
    } = body;

    const [updated] = await db
      .update(familyMembers)
      .set({
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName: lastName ?? null }),
        ...(relationship !== undefined && { relationship }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth || null }),
        ...(notes !== undefined && { notes: notes ?? null }),
        ...(domesticPartner !== undefined && { domesticPartner: !!domesticPartner }),
        ...(inheritanceClassOverride !== undefined && { inheritanceClassOverride }),
        updatedAt: new Date(),
      })
      .where(and(eq(familyMembers.id, memberId), eq(familyMembers.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    }

    await recordAudit({
      action: "family_member.update",
      resourceType: "family_member",
      resourceId: memberId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { firstName: updated.firstName, relationship: updated.relationship }),
    });

    return NextResponse.json(updated);
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

    // Remove any will-recipient rows that point at this family member before
    // deleting it — recipient_id is a polymorphic FK-less column, so a plain
    // delete would leave a dangling id and silently wrong estate projections
    // (audit F13). Atomic with the member delete.
    await db.transaction(async (tx) => {
      await cleanupWillRecipientReferences(tx, "family_member", memberId);
      await pruneOrphanScenarioChanges(tx, memberId);
      await tx
        .delete(familyMembers)
        .where(and(eq(familyMembers.id, memberId), eq(familyMembers.clientId, id)));
    });

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
