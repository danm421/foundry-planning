// src/app/api/clients/[id]/related-parties/[partyId]/route.ts
//
// The update leg for a related party. See the sibling `../route.ts` for why
// this client-keyed pair exists at all.
import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { updateRelatedPartyForClient } from "@/lib/clients/related-parties-writes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; partyId: string }> },
) {
  try {
    const { id, partyId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { client, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await updateRelatedPartyForClient({
      clientId: id,
      firmId,
      householdId: client.crmHouseholdId,
      partyId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ id: result.data.id });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/related-parties/[partyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
