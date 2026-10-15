import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gifts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { updateGiftForClient } from "@/lib/clients/gifts-writes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const { id, giftId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const body = await request.json();
    const result = await updateGiftForClient({
      clientId: id,
      firmId,
      giftId,
      input: body,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const { id, giftId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    let row: typeof gifts.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(gifts)
        .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
        .returning();
      row = deleted;
      if (deleted) {
        await pruneOrphanScenarioChanges(tx, giftId, id);
      }
    });
    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    await recordAudit({
      action: "gift.delete",
      resourceType: "gift",
      resourceId: giftId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { year: row.year, grantor: row.grantor }),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
