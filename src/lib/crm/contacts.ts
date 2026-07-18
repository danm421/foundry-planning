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
  const [created] = input.familyMemberId
    ? await insertQuery
        .onConflictDoUpdate({
          target: crmHouseholdContacts.familyMemberId,
          targetWhere: sql`family_member_id is not null`,
          set: {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email || null,
            phone: input.phone ?? null,
            mobile: input.mobile ?? null,
            notes: input.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning()
    : await insertQuery.returning();

  // Adding a primary/spouse changes the derived household name; keep it in sync.
  if (syncHouseholdName && roleAffectsHouseholdName(input.role)) {
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
