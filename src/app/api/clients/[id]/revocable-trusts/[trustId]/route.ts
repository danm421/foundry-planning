import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { revocableTrusts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { updateRevocableTrustForClient, verifyTrust } from "@/lib/clients/revocable-trusts-writes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; trustId: string }> }
) {
  try {
    const { id, trustId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await verifyTrust(trustId, id))) {
      return NextResponse.json({ error: "Trust not found" }, { status: 404 });
    }

    const result = await updateRevocableTrustForClient({
      clientId: id,
      firmId,
      trustId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/revocable-trusts/[trustId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; trustId: string }> }
) {
  try {
    const { id, trustId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const trust = await verifyTrust(trustId, id);
    if (!trust) {
      return NextResponse.json({ error: "Trust not found" }, { status: 404 });
    }

    // Delete the trust row. FK ON DELETE SET NULL on accounts.revocable_trust_id
    // untags all member accounts automatically.
    await db
      .delete(revocableTrusts)
      .where(and(eq(revocableTrusts.id, trustId), eq(revocableTrusts.clientId, id)));

    await recordAudit({
      action: "revocable_trust.delete",
      resourceType: "revocable_trust",
      resourceId: trustId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: trust.name }),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/revocable-trusts/[trustId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
