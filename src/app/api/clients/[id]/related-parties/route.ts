// src/app/api/clients/[id]/related-parties/route.ts
//
// The external people a client's documents name — trustees, executors, powers
// of attorney, CPAs, attorneys — which live in the CRM's household contacts.
//
// A thin CLIENT-keyed wrapper over a HOUSEHOLD-keyed table. The CRM's own
// route (`/api/crm/households/[id]/contacts`) already writes this table, but it
// is keyed by the CRM household id, and the Details field map's routes are all
// paths below `/api/clients/[id]`. So this pair exists rather than widening the
// route type for one entity.
//
// Deliberately NOT `createCrmContact` from `@/lib/crm/contacts`: that gates on
// `requireCrmHouseholdAccess`, which scopes the household to the CALLER's org.
// A client shared in from another firm is editable here (that is what
// `requireClientEditAccess` decides) but its household belongs to the owning
// firm, so the CRM gate would refuse a write this route must allow.
import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createRelatedPartyForClient } from "@/lib/clients/related-parties-writes";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { client, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const result = await createRelatedPartyForClient({
      clientId: id,
      firmId,
      // The PATH client's own household, never a `householdId` in the body.
      householdId: client.crmHouseholdId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    // `{ id }`, because `readCreatedId` in `commit-map-row.ts` stamps it onto
    // the extracted row so a second Commit cannot duplicate the contact.
    return NextResponse.json({ id: result.data.id }, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/related-parties error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
