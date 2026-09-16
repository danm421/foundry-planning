// src/app/api/clients/[id]/related-parties/[partyId]/route.ts
//
// The update leg for a related party. See the sibling `../route.ts` for why
// this client-keyed pair exists at all.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { relatedPartyUpdateSchema } from "@/lib/schemas/related-parties";

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

    const parsed = relatedPartyUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: summarizeZodIssues(parsed.error) }, { status: 400 });
    }

    const [updated] = await db
      .update(crmHouseholdContacts)
      .set({ ...parsed.data, updatedAt: new Date() })
      // Three legs, and the last two are the ownership check. Without the
      // household leg a `partyId` from another firm's household is writable
      // through this client's id; without the role leg the household's own
      // primary or spouse — the client and their partner, owned by the
      // household surface — is editable from here. Both are part of the
      // predicate rather than a prior SELECT, so there is no window between
      // the check and the write.
      .where(
        and(
          eq(crmHouseholdContacts.id, partyId),
          eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
          eq(crmHouseholdContacts.role, "other"),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Related party not found" }, { status: 404 });
    }

    await recordAudit({
      action: "related_party.update",
      resourceType: "crm_household_contact",
      resourceId: partyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        firstName: updated.firstName,
        lastName: updated.lastName,
        relationshipLabel: updated.relationshipLabel,
      }),
    });

    return NextResponse.json({ id: updated.id });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/related-parties/[partyId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
