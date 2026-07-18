import { db } from "@/db";
import { crmHouseholdContacts, familyMembers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import { resolveContactDateOfBirth } from "./default-dob";
import { syncHouseholdNameFromContacts } from "./sync-household-name";
import { roleAffectsHouseholdName } from "./household-name";
import type { CreateCrmContactInput } from "./schemas";

// A linked contact row must point at a family member of THIS household's
// planning client — never trust a client-supplied familyMemberId.
async function assertFamilyMemberInHousehold(householdId: string, familyMemberId: string) {
  const member = await db.query.familyMembers.findFirst({
    where: eq(familyMembers.id, familyMemberId),
    with: { client: { columns: { crmHouseholdId: true } } },
  });
  if (!member || member.client.crmHouseholdId !== householdId) {
    throw new Error("Family member does not belong to this household");
  }
}

export async function createCrmContact(
  householdId: string,
  input: CreateCrmContactInput,
  // Bulk CSV import seeds households with advisor-typed names ("Johnson Trust")
  // then adds contacts; it opts out so the derived name doesn't clobber them.
  // The interactive add-contact endpoint keeps the default so adding a spouse
  // updates the household name.
  options: { syncHouseholdName?: boolean } = {},
) {
  const { syncHouseholdName = true } = options;
  const { orgId } = await requireCrmHouseholdAccess(householdId);
  const { userId } = await auth();

  if (input.familyMemberId) {
    await assertFamilyMemberInHousehold(householdId, input.familyMemberId);
  }

  const insertQuery = db.insert(crmHouseholdContacts).values({
    householdId,
    role: input.role,
    firstName: input.firstName,
    lastName: input.lastName,
    preferredName: input.preferredName,
    dateOfBirth: resolveContactDateOfBirth(input.role, input.dateOfBirth),
    email: input.email || null,
    phone: input.phone,
    mobile: input.mobile,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    ssnLast4: input.ssnLast4,
    maritalStatus: input.maritalStatus,
    employmentStatus: input.employmentStatus,
    employer: input.employer,
    occupation: input.occupation,
    notes: input.notes,
    relationshipLabel: input.relationshipLabel,
    familyMemberId: input.familyMemberId,
  });

  // Lazy-linking is idempotent: a second create for an already-linked family
  // member refreshes the contact fields in place rather than violating the
  // partial unique index on family_member_id.
  //
  // The refresh is non-destructive. A partial payload (say, one that only knows
  // the member's name) must not wipe advisor-entered contact info, so every
  // nullable field coalesces the proposed value over the stored one: supplying a
  // field overwrites it, omitting it keeps whatever is already there. Inside
  // ON CONFLICT DO UPDATE, `excluded.x` is the proposed row and the qualified
  // table reference is the existing row. first/last name are NOT NULL snapshot
  // columns and stay unconditional so name-based CRM search stays current.
  //
  // The set below lists every nullable column of the insert values above, in the
  // same order — a column missing here is silently dropped on re-link, which is
  // the bug this shape exists to prevent. Deliberately absent: household_id and
  // family_member_id (invariant — the conflict key, and its household is pinned
  // by assertFamilyMemberInHousehold) and `role` (see comment on the set).
  // date_of_birth needs no special casing: `excluded.date_of_birth` IS the
  // resolveContactDateOfBirth(...) output the insert computed, so the conflict
  // path coalesces the resolved value, never the raw input.
  const [created] = input.familyMemberId
    ? await insertQuery
        .onConflictDoUpdate({
          target: crmHouseholdContacts.familyMemberId,
          targetWhere: sql`family_member_id is not null`,
          set: {
            // `role` is intentionally NOT refreshed: a conflicting create is a
            // re-link of an existing row, not a role change (those go through
            // updateCrmContact), and setting it here could collide with the
            // one-primary/one-spouse partial unique indexes — a second conflict
            // that ON CONFLICT DO UPDATE cannot resolve, turning today's 201
            // into an unhandled 23505.
            firstName: input.firstName,
            lastName: input.lastName,
            preferredName: sql`coalesce(excluded.preferred_name, ${crmHouseholdContacts.preferredName})`,
            dateOfBirth: sql`coalesce(excluded.date_of_birth, ${crmHouseholdContacts.dateOfBirth})`,
            email: sql`coalesce(excluded.email, ${crmHouseholdContacts.email})`,
            phone: sql`coalesce(excluded.phone, ${crmHouseholdContacts.phone})`,
            mobile: sql`coalesce(excluded.mobile, ${crmHouseholdContacts.mobile})`,
            addressLine1: sql`coalesce(excluded.address_line1, ${crmHouseholdContacts.addressLine1})`,
            addressLine2: sql`coalesce(excluded.address_line2, ${crmHouseholdContacts.addressLine2})`,
            city: sql`coalesce(excluded.city, ${crmHouseholdContacts.city})`,
            state: sql`coalesce(excluded.state, ${crmHouseholdContacts.state})`,
            postalCode: sql`coalesce(excluded.postal_code, ${crmHouseholdContacts.postalCode})`,
            country: sql`coalesce(excluded.country, ${crmHouseholdContacts.country})`,
            ssnLast4: sql`coalesce(excluded.ssn_last4, ${crmHouseholdContacts.ssnLast4})`,
            maritalStatus: sql`coalesce(excluded.marital_status, ${crmHouseholdContacts.maritalStatus})`,
            employmentStatus: sql`coalesce(excluded.employment_status, ${crmHouseholdContacts.employmentStatus})`,
            employer: sql`coalesce(excluded.employer, ${crmHouseholdContacts.employer})`,
            occupation: sql`coalesce(excluded.occupation, ${crmHouseholdContacts.occupation})`,
            notes: sql`coalesce(excluded.notes, ${crmHouseholdContacts.notes})`,
            relationshipLabel: sql`coalesce(excluded.relationship_label, ${crmHouseholdContacts.relationshipLabel})`,
            updatedAt: new Date(),
          },
        })
        .returning()
    : await insertQuery.returning();

  // Adding a primary/spouse changes the derived household name; keep it in sync.
  // Branch on the PERSISTED role, not the submitted one: since the conflict path
  // leaves `role` alone, a re-link submitting role:"primary" against a stored
  // dependent row must not act as if the row became primary.
  if (syncHouseholdName && roleAffectsHouseholdName(created.role)) {
    await syncHouseholdNameFromContacts(db, householdId);
  }

  await recordAudit({
    action: "crm.contact.create",
    resourceType: "crm_contact",
    resourceId: created.id,
    firmId: orgId,
  });
  await recordActivity(
    {
      householdId,
      kind: "contact_change",
      title: `Added ${input.role}: ${input.firstName} ${input.lastName}`,
      metadata: { contactId: created.id, role: input.role },
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
  return created;
}

export async function updateCrmContact(contactId: string, patch: Partial<CreateCrmContactInput>) {
  const existing = await db.query.crmHouseholdContacts.findFirst({
    where: eq(crmHouseholdContacts.id, contactId),
  });
  if (!existing) throw new Error("Contact not found");
  const { orgId } = await requireCrmHouseholdAccess(existing.householdId);
  const { userId } = await auth();

  if (patch.familyMemberId) {
    await assertFamilyMemberInHousehold(existing.householdId, patch.familyMemberId);
  }

  const nameChanging = "firstName" in patch || "lastName" in patch;

  const [updated] = await db
    .update(crmHouseholdContacts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(crmHouseholdContacts.id, contactId))
    .returning();

  // Keep the denormalized household name tracking the contacts — only when a
  // name changed on a role that actually feeds the name (primary/spouse).
  if (nameChanging && roleAffectsHouseholdName(existing.role)) {
    await syncHouseholdNameFromContacts(db, existing.householdId);
  }

  await recordAudit({
    action: "crm.contact.update",
    resourceType: "crm_contact",
    resourceId: contactId,
    firmId: orgId,
  });
  await recordActivity(
    {
      householdId: existing.householdId,
      kind: "contact_change",
      title: `Updated ${existing.role}: ${existing.firstName} ${existing.lastName}`,
      metadata: { contactId, fields: Object.keys(patch) },
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
  return updated;
}

export async function deleteCrmContact(contactId: string) {
  const existing = await db.query.crmHouseholdContacts.findFirst({
    where: eq(crmHouseholdContacts.id, contactId),
  });
  if (!existing) return;
  const { orgId } = await requireCrmHouseholdAccess(existing.householdId);
  const { userId } = await auth();
  await db.delete(crmHouseholdContacts).where(eq(crmHouseholdContacts.id, contactId));

  // Removing a primary/spouse changes the derived household name; e.g. deleting
  // a spouse collapses "Jane & Jim Doe" back to "Jane Doe".
  if (roleAffectsHouseholdName(existing.role)) {
    await syncHouseholdNameFromContacts(db, existing.householdId);
  }

  await recordAudit({
    action: "crm.contact.delete",
    resourceType: "crm_contact",
    resourceId: contactId,
    firmId: orgId,
  });
  await recordActivity(
    {
      householdId: existing.householdId,
      kind: "contact_change",
      title: `Removed ${existing.role}: ${existing.firstName} ${existing.lastName}`,
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
}
