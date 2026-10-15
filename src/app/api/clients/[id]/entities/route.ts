import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entities, entityOwners } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createEntityForClient } from "@/lib/clients/entities-writes";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(entities)
      .where(eq(entities.clientId, id))
      .orderBy(asc(entities.name));

    const entityIds = rows.map((r) => r.id);
    const ownerRows = entityIds.length > 0
      ? await db
          .select()
          .from(entityOwners)
          .where(inArray(entityOwners.entityId, entityIds))
      : [];
    const ownersByEntity = new Map<string, { kind: "family_member"; familyMemberId: string; percent: number }[]>();
    for (const o of ownerRows) {
      // entity_owners now also models entity-owned-by-entity rows (ownerEntityId);
      // this endpoint surfaces only family-member owners.
      if (!o.familyMemberId) continue;
      const arr = ownersByEntity.get(o.entityId) ?? [];
      arr.push({ kind: "family_member", familyMemberId: o.familyMemberId, percent: parseFloat(o.percent) });
      ownersByEntity.set(o.entityId, arr);
    }
    const enriched = rows.map((r) => ({
      ...r,
      owners: ownersByEntity.get(r.id) ?? [],
    }));
    return NextResponse.json(enriched);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await createEntityForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
