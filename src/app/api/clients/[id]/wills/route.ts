import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  wills,
  willBequests,
  willBequestRecipients,
  willResiduaryRecipients,
} from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { createWillForClient } from "@/lib/clients/wills-writes";
import { computeSoftWarnings } from "./_helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

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
    const willRows = await db
      .select()
      .from(wills)
      .where(eq(wills.clientId, id))
      .orderBy(asc(wills.grantor));
    if (willRows.length === 0) return NextResponse.json([]);

    const willIds = willRows.map((w) => w.id);
    const bequestRows = await db
      .select()
      .from(willBequests)
      .where(inArray(willBequests.willId, willIds))
      .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder));
    const bequestIds = bequestRows.map((b) => b.id);
    const recipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(
            asc(willBequestRecipients.bequestId),
            asc(willBequestRecipients.sortOrder),
          )
      : [];
    const residuaryRows = await db
      .select()
      .from(willResiduaryRecipients)
      .where(inArray(willResiduaryRecipients.willId, willIds))
      .orderBy(
        asc(willResiduaryRecipients.willId),
        asc(willResiduaryRecipients.sortOrder),
      );

    const recipientsByBequest = new Map<string, typeof recipientRows>();
    for (const r of recipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    const bequestsByWill = new Map<string, unknown[]>();
    for (const b of bequestRows) {
      const list = bequestsByWill.get(b.willId) ?? [];
      list.push({
        id: b.id,
        kind: b.kind,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        entityId: b.entityId,
        liabilityId: b.liabilityId,
        percentage: parseFloat(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder,
        recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
      });
      bequestsByWill.set(b.willId, list);
    }
    const residuaryByWill = new Map<string, typeof residuaryRows>();
    for (const r of residuaryRows) {
      const list = residuaryByWill.get(r.willId) ?? [];
      list.push(r);
      residuaryByWill.set(r.willId, list);
    }
    return NextResponse.json(
      willRows.map((w) => ({
        id: w.id,
        grantor: w.grantor,
        bequests: bequestsByWill.get(w.id) ?? [],
        residuaryRecipients: (residuaryByWill.get(w.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          tier: r.tier,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
      })),
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/wills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await createWillForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }
    return NextResponse.json(
      { id: result.resourceId, warnings: computeSoftWarnings(result.data.bequests) },
      { status: 201 },
    );
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/wills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
