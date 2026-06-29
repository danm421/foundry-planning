import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  planSettings,
  familyMembers,
  accountOwners,
  liabilityOwners,
  entityOwners,
  beneficiaryDesignations,
  gifts,
  trustSplitInterestDetails,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { recordUpdate, recordDelete } from "@/lib/audit";
import { toClientSnapshot, CLIENT_FIELD_LABELS } from "@/lib/audit/snapshots/client";
import { mirrorContactToCrm } from "@/lib/clients/mirror-contact-to-crm";
import { syncHouseholdNameFromContacts } from "@/lib/crm/sync-household-name";
import { requireClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// GET /api/clients/[id] — get single client
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await requireClientAccess(id).catch(() => null);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { client } = access;

    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id] — update client. Identity now lives on CRM contacts;
// this endpoint accepts identity fields (firstName/lastName/dateOfBirth/email/
// address + spouse*) and mirrors them onto the linked CRM household contacts,
// then writes the planning-only fields onto the clients row.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { client: existing, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const body = await request.json();

    // Load the CRM contacts so we know the current identity state for
    // horizon recompute, spouse-removal pre-checks, and family_member sync.
    const crmContactRows = await db
      .select()
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, existing.crmHouseholdId));
    const primaryContact = crmContactRows.find((c) => c.role === "primary") ?? null;
    const spouseContact = crmContactRows.find((c) => c.role === "spouse") ?? null;

    if (!primaryContact?.dateOfBirth) {
      return NextResponse.json(
        { error: "CRM household is missing a primary contact with a date of birth" },
        { status: 422 },
      );
    }

    // If the body removes the spouse (spouseName cleared), pre-check that no
    // rows still reference the spouse family_member. Account/liability owner
    // triggers would otherwise abort the cascade with cryptic errors, and the
    // CLT measuring-life FK is RESTRICT. Block here with a clear 409
    // before mutating clients so we don't end up half-updated.
    const spouseBeingRemoved =
      "spouseName" in body &&
      (body.spouseName == null || body.spouseName === "") &&
      spouseContact?.firstName != null &&
      spouseContact.firstName !== "";
    if (spouseBeingRemoved) {
      const [spouseFm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, id), eq(familyMembers.role, "spouse")));
      if (spouseFm) {
        const blockers = await collectSpouseDependents(spouseFm.id);
        if (blockers.length > 0) {
          return NextResponse.json(
            {
              error: `Cannot remove spouse: still referenced by ${blockers.join(", ")}. Reassign or delete those first.`,
            },
            { status: 409 },
          );
        }
      }
    }

    // Re-derive planEndAge whenever any input to the horizon calc changes.
    // Identity inputs to the horizon (dob, spouseDob) come from the body OR
    // the CRM contacts — never from the clients row anymore.
    const updateBody = { ...body };
    const dobChanged = "dateOfBirth" in body;
    const leChanged = "lifeExpectancy" in body;
    const spouseDobChanged = "spouseDob" in body;
    const spouseLeChanged = "spouseLifeExpectancy" in body;
    if (dobChanged || leChanged || spouseDobChanged || spouseLeChanged) {
      const effectiveClientDob = body.dateOfBirth ?? primaryContact.dateOfBirth;
      const effectiveSpouseDob = spouseDobChanged
        ? body.spouseDob ?? null
        : spouseContact?.dateOfBirth ?? null;
      updateBody.planEndAge = computePlanEndAge({
        clientDob: effectiveClientDob,
        clientLifeExpectancy: Number(body.lifeExpectancy ?? existing.lifeExpectancy),
        spouseDob: effectiveSpouseDob,
        spouseLifeExpectancy:
          spouseLeChanged
            ? body.spouseLifeExpectancy != null
              ? Number(body.spouseLifeExpectancy)
              : null
            : existing.spouseLifeExpectancy ?? null,
      });
    }

    // Mirror identity fields in the body to CRM contacts. Identity is no
    // longer stored on the clients row — CRM is the source of truth.
    const identityPatch: Record<string, unknown> = {};
    for (const key of IDENTITY_FIELDS) {
      if (key in updateBody) identityPatch[key] = updateBody[key];
    }

    // Explicit allowlist of mutable columns on the clients row itself.
    // Identity fields live on CRM contacts and are mirrored above — not
    // included here.
    const MUTABLE_CLIENT_FIELDS = [
      "retirementAge",
      "retirementMonth",
      "planEndAge",
      "lifeExpectancy",
      "spouseRetirementAge",
      "spouseRetirementMonth",
      "spouseLifeExpectancy",
      "filingStatus",
    ] as const;

    const safeUpdate: Record<string, unknown> = {};
    const incoming = updateBody as Record<string, unknown>;
    for (const key of MUTABLE_CLIENT_FIELDS) {
      if (key in incoming) safeUpdate[key] = incoming[key];
    }

    // Atomically mirror identity to CRM and update the clients row so a partial
    // failure can't leave CRM contacts ahead of the planning row (or vice
    // versa). Audit/plan-settings/family-member sync below stay outside — they
    // are idempotent and not load-bearing for contact-info correctness.
    // Did this edit touch any name field? If so, the denormalized CRM
    // household name may need to follow (handled inside the txn below).
    const nameChanged = HOUSEHOLD_NAME_FIELDS.some((k) => k in identityPatch);

    const updated = await db.transaction(async (tx) => {
      await mirrorContactToCrm(tx, existing.crmHouseholdId, identityPatch);
      const [u] = await tx
        .update(clients)
        .set({
          ...safeUpdate,
          updatedAt: new Date(),
        })
        .where(and(eq(clients.id, id), eq(clients.firmId, firmId)))
        .returning();
      // Keep the CRM household name in sync with the (now-mirrored) contacts.
      if (nameChanged) {
        await syncHouseholdNameFromContacts(tx, existing.crmHouseholdId);
      }
      return u;
    });

    // If the horizon moved, push the new planEndYear through to all the
    // client's scenarios so the engine and UI stay in sync without the
    // advisor having to re-save plan settings. We derive from the CRM
    // primary's date of birth (post-mirror it may have just changed).
    if (updateBody.planEndAge != null) {
      const dobForHorizon =
        (identityPatch.dateOfBirth as string | undefined) ??
        primaryContact.dateOfBirth;
      const newEndYear = new Date(dobForHorizon).getFullYear() + updateBody.planEndAge;
      await db
        .update(planSettings)
        .set({ planEndYear: newEndYear, updatedAt: new Date() })
        .where(eq(planSettings.clientId, id));
    }

    // Build the effective identity snapshot (post-patch) for family_member
    // sync and audit. CRM contacts are the source of truth; we layer any
    // identityPatch fields on top.
    const effectiveIdentity = buildEffectiveIdentity(
      primaryContact,
      spouseContact,
      identityPatch,
    );

    await syncHouseholdFamilyMembers(id, effectiveIdentity);

    await recordUpdate({
      action: "client.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      before: toClientSnapshot(existing),
      after: toClientSnapshot(updated),
      fieldLabels: CLIENT_FIELD_LABELS,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Subset of identity fields that feed the auto-generated household name. A
// change to any of these may need to propagate to crmHouseholds.name.
const HOUSEHOLD_NAME_FIELDS = [
  "firstName",
  "lastName",
  "spouseName",
  "spouseLastName",
] as const;

// Identity fields the PUT body may carry. These live on CRM contacts post-port;
// the corresponding clients columns have been dropped. Keep both flat name
// fields (legacy advisor habit) and CRM-shaped fields as accepted input.
const IDENTITY_FIELDS = [
  // legacy identity (CRM-owned)
  "firstName",
  "lastName",
  "dateOfBirth",
  "spouseName",
  "spouseLastName",
  "spouseDob",
  // primary contact info
  "email",
  "phone",
  "mobile",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  // legacy single-line address blob — accepted for back-compat; routed to addressLine1
  "address",
  // spouse contact info
  "spouseEmail",
  "spousePhone",
  "spouseMobile",
  "spouseAddressLine1",
  "spouseAddressLine2",
  "spouseCity",
  "spouseState",
  "spousePostalCode",
  "spouseCountry",
  "spouseAddress",
] as const;

// DELETE /api/clients/[id] — delete client
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { client: existing, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const snapshot = toClientSnapshot(existing);

    await db
      .delete(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    await recordDelete({
      action: "client.delete",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      snapshot,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Returns a list of human-readable references that block deleting the spouse
// family_member. account_owners / liability_owners / entity_owners would
// trigger sum-violation aborts on cascade; trust_split_interest_details
// measuring lives are RESTRICT FKs; beneficiary_designations and gifts cascade
// cleanly but we surface them so removal isn't silent data loss.
async function collectSpouseDependents(spouseFmId: string): Promise<string[]> {
  const [accs, liabs, ents, mlife, beneRefs, giftRefs] = await Promise.all([
    db.select({ id: accountOwners.accountId }).from(accountOwners).where(eq(accountOwners.familyMemberId, spouseFmId)).limit(1),
    db.select({ id: liabilityOwners.liabilityId }).from(liabilityOwners).where(eq(liabilityOwners.familyMemberId, spouseFmId)).limit(1),
    db.select({ id: entityOwners.entityId }).from(entityOwners).where(eq(entityOwners.familyMemberId, spouseFmId)).limit(1),
    db
      .select({ id: trustSplitInterestDetails.entityId })
      .from(trustSplitInterestDetails)
      .where(or(eq(trustSplitInterestDetails.measuringLife1Id, spouseFmId), eq(trustSplitInterestDetails.measuringLife2Id, spouseFmId)))
      .limit(1),
    db.select({ id: beneficiaryDesignations.id }).from(beneficiaryDesignations).where(eq(beneficiaryDesignations.familyMemberId, spouseFmId)).limit(1),
    db.select({ id: gifts.id }).from(gifts).where(eq(gifts.recipientFamilyMemberId, spouseFmId)).limit(1),
  ]);
  const out: string[] = [];
  if (accs.length) out.push("accounts");
  if (liabs.length) out.push("liabilities");
  if (ents.length) out.push("business ownership");
  if (mlife.length) out.push("trust measuring lives");
  if (beneRefs.length) out.push("beneficiary designations");
  if (giftRefs.length) out.push("gifts");
  return out;
}

// Identity-only snapshot used by syncHouseholdFamilyMembers. Built by
// buildEffectiveIdentity from CRM contacts + an optional identity patch.
type EffectiveIdentity = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  spouseName: string | null;
  spouseLastName: string | null;
  spouseDob: string | null;
};

// Compose the effective identity from the CRM contacts plus any in-flight
// patch coming through the PUT body. CRM is the source of truth; the patch
// represents the user's intent that's already been mirrored above.
function buildEffectiveIdentity(
  primary: { firstName: string; lastName: string; dateOfBirth: string | null },
  spouse: { firstName: string; lastName: string; dateOfBirth: string | null } | null,
  patch: Record<string, unknown>,
): EffectiveIdentity {
  const pick = <T,>(key: string, fallback: T): T =>
    key in patch ? (patch[key] as T) : fallback;
  const spouseFirst = pick<string | null>(
    "spouseName",
    spouse?.firstName ?? null,
  );
  return {
    firstName: pick("firstName", primary.firstName),
    lastName: pick("lastName", primary.lastName),
    dateOfBirth: pick("dateOfBirth", primary.dateOfBirth ?? ""),
    spouseName: spouseFirst,
    spouseLastName: pick<string | null>(
      "spouseLastName",
      spouse?.lastName ?? null,
    ),
    spouseDob: pick<string | null>("spouseDob", spouse?.dateOfBirth ?? null),
  };
}

// Reconciles role='client' / role='spouse' family_members rows with the
// post-update identity. Insert/update/delete as needed. Caller is expected
// to have already pre-checked that any spouse removal is dependent-free.
async function syncHouseholdFamilyMembers(
  clientId: string,
  c: EffectiveIdentity,
): Promise<void> {
  const rows = await db
    .select()
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.role, ["client", "spouse"])));
  const clientRow = rows.find((r) => r.role === "client");
  const spouseRow = rows.find((r) => r.role === "spouse");

  if (clientRow) {
    await db
      .update(familyMembers)
      .set({
        firstName: c.firstName,
        lastName: c.lastName,
        dateOfBirth: c.dateOfBirth,
        updatedAt: new Date(),
      })
      .where(eq(familyMembers.id, clientRow.id));
  } else {
    await db.insert(familyMembers).values({
      clientId,
      role: "client",
      relationship: "other",
      firstName: c.firstName,
      lastName: c.lastName,
      dateOfBirth: c.dateOfBirth,
    });
  }

  if (c.spouseName) {
    const spouseFields = {
      firstName: c.spouseName,
      lastName: c.spouseLastName ?? c.lastName,
      dateOfBirth: c.spouseDob ?? null,
    };
    if (spouseRow) {
      await db
        .update(familyMembers)
        .set({ ...spouseFields, updatedAt: new Date() })
        .where(eq(familyMembers.id, spouseRow.id));
    } else {
      await db.insert(familyMembers).values({
        clientId,
        role: "spouse",
        relationship: "other",
        ...spouseFields,
      });
    }
  } else if (spouseRow) {
    await db.delete(familyMembers).where(eq(familyMembers.id, spouseRow.id));
  }
}
