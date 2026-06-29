import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import { resolveContactDateOfBirth } from "./default-dob";
import { syncHouseholdNameFromContacts } from "./sync-household-name";
import type { CreateCrmContactInput } from "./schemas";

export async function createCrmContact(householdId: string, input: CreateCrmContactInput) {
  const { orgId } = await requireCrmHouseholdAccess(householdId);
  const { userId } = await auth();

  const [created] = await db
    .insert(crmHouseholdContacts)
    .values({
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
    })
    .returning();

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

  const nameChanging = "firstName" in patch || "lastName" in patch;

  const [updated] = await db
    .update(crmHouseholdContacts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(crmHouseholdContacts.id, contactId))
    .returning();

  // Keep the denormalized household name tracking the contacts.
  if (nameChanging) {
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
