import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  wills,
  willBequests,
  willBequestRecipients,
  willResiduaryRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { updateWillForClient, willBelongsToClient } from "@/lib/clients/wills-writes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const { id, willId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [willRow] = await db
      .select()
      .from(wills)
      .where(and(eq(wills.id, willId), eq(wills.clientId, id)));
    if (!willRow) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    const bequestRows = await db
      .select()
      .from(willBequests)
      .where(eq(willBequests.willId, willId))
      .orderBy(asc(willBequests.sortOrder));
    const bequestIds = bequestRows.map((b) => b.id);
    const recipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(asc(willBequestRecipients.sortOrder))
      : [];
    const residuaryRows = await db
      .select()
      .from(willResiduaryRecipients)
      .where(eq(willResiduaryRecipients.willId, willRow.id))
      .orderBy(asc(willResiduaryRecipients.sortOrder));

    const recipientsByBequest = new Map<string, typeof recipientRows>();
    for (const r of recipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    return NextResponse.json({
      id: willRow.id,
      grantor: willRow.grantor,
      bequests: bequestRows.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        entityId: b.entityId,
        liabilityId: b.liabilityId,
        dollarSource: b.dollarSource,
        fallbackToEstate: b.fallbackToEstate,
        percentage: parseFloat(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder,
        recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: r.percentage == null ? null : parseFloat(r.percentage),
          amount: r.amount == null ? null : parseFloat(r.amount),
          sortOrder: r.sortOrder,
        })),
      })),
      residuaryRecipients: residuaryRows.map((r) => ({
        id: r.id,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        tier: r.tier,
        percentage: parseFloat(r.percentage),
        sortOrder: r.sortOrder,
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const { id, willId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    // Before the body is read, as the route always has; the core repeats it for the save.
    if (!(await willBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    const result = await updateWillForClient({
      clientId: id,
      firmId,
      willId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }
    return NextResponse.json({ id: willId });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const { id, willId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await willBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    await db.transaction(async (tx) => {
      await tx.delete(wills).where(eq(wills.id, willId));
      await pruneOrphanScenarioChanges(tx, willId, id);
    });
    await recordAudit({
      action: "will.delete",
      resourceType: "will",
      resourceId: willId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
