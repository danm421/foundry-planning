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
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { relatedPartyCreateSchema } from "@/lib/schemas/related-parties";

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

    const parsed = relatedPartyCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: summarizeZodIssues(parsed.error) }, { status: 400 });
    }
    const {
      role, firstName, lastName, relationshipLabel,
      email, phone, mobile, employer, occupation, notes,
    } = parsed.data;

    const [contact] = await db
      .insert(crmHouseholdContacts)
      .values({
        // The PATH client's own household, never a `householdId` in the body —
        // that is the only thing standing between this route and a write into
        // another firm's household. `clients.crmHouseholdId` is notNull and
        // unique, so every client has exactly one and it is never ambiguous.
        householdId: client.crmHouseholdId,
        // Fixed to "other" by the schema. `familyMemberId` is deliberately
        // never set: it is the key of a partial unique index, and a planning
        // link belongs to the `dependent` role, not to an external contact.
        role,
        firstName,
        lastName,
        relationshipLabel,
        email,
        phone,
        mobile,
        employer,
        occupation,
        notes,
      })
      .returning();

    await recordAudit({
      action: "related_party.create",
      resourceType: "crm_household_contact",
      resourceId: contact.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        firstName: contact.firstName,
        lastName: contact.lastName,
        relationshipLabel: contact.relationshipLabel,
      }),
    });

    // `{ id }`, because `readCreatedId` in `commit-map-row.ts` stamps it onto
    // the extracted row so a second Commit cannot duplicate the contact.
    return NextResponse.json({ id: contact.id }, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/related-parties error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
