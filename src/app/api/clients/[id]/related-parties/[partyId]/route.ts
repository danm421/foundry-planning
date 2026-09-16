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

    // A body that asks for NOTHING is refused, not performed. Left to run, the
    // update would set only `updatedAt`, answer 200 and file a
    // `related_party.update` audit row for a change that never happened — and
    // `commitMapRow` reads any 2xx as a landed write, so the advisor's review
    // row would be stamped "committed" having written nothing.
    //
    // Reached in practice, not just by a hand-crafted request:
    // `buildWriteRequest`'s update leg skips every `writable: false` field, so
    // a row whose extracted keys are all non-writable yields exactly `{}`. A
    // body of keys this schema strips (`role`, `householdId`) lands here too.
    //
    // 400 rather than 422: the repo already answers 400 for this case in
    // `portal/settings`, `portal/transactions/[id]` and the `toggle-groups`
    // PATCH, whose wording this borrows. 422 is used here for input that WAS
    // processed and yielded nothing usable (an OCR read, an AI call), which is
    // not what a caller asking for no change is.
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json(
        { error: "PATCH body must include at least one field to update" },
        { status: 400 },
      );
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
      // Same predicate, same status — a better sentence. `commitMapRow` shows
      // this text to the advisor, and a bare "not found" for a person they can
      // see on the Household screen reads as a bug. It names the likely reason
      // without claiming it: the other way to land here is a `partyId` from
      // another household, which is genuinely not found.
      //
      // "primary, spouse or dependent", not "client and spouse": the role leg
      // refuses all three non-`other` values of `crmContactRoleEnum`, and a
      // dependent hitting a sentence about spouses would be told the wrong
      // thing. Worded as the roles, not as the enum, for the advisor.
      return NextResponse.json(
        {
          error:
            "Related party not found — the household's own contacts (the client, their co-client and any dependants) are edited on the Household screen, not here.",
        },
        { status: 404 },
      );
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
