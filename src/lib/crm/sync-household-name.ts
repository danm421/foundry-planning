import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import {
  deriveHouseholdNameFromContacts,
  resolveAutoHouseholdName,
  type ContactNameParts,
} from "./household-name";

// Drizzle transaction handle — same convention as src/lib/clients/mirror-contact-to-crm.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Accepts either the base db or a transaction so callers can run inside or
// outside an existing transaction.
type Executor = typeof db | Tx;

/**
 * Keeps a CRM household's denormalized `name` column in sync with its contacts'
 * names — but only when the name is still auto-generated.
 *
 * Call this AFTER the contact rows have been updated, passing a snapshot of the
 * contacts as they were BEFORE the edit (`prevContacts`). The pre-edit names let
 * us tell whether the stored household name was tracking the auto pattern or was
 * manually customized; customized names are left untouched (see
 * resolveAutoHouseholdName).
 *
 * No-ops silently when the household is gone or the name doesn't need to change.
 */
export async function syncHouseholdNameFromContacts(
  exec: Executor,
  householdId: string,
  prevContacts: ReadonlyArray<ContactNameParts>,
): Promise<void> {
  const prevName = deriveHouseholdNameFromContacts(prevContacts);
  if (prevName == null) return;

  const [household] = await exec
    .select({ name: crmHouseholds.name })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, householdId));
  if (!household) return;

  const currentContacts = await exec
    .select({
      role: crmHouseholdContacts.role,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
    })
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, householdId));

  const newName = resolveAutoHouseholdName({
    storedName: household.name,
    prevName,
    newName: deriveHouseholdNameFromContacts(currentContacts),
  });
  if (newName == null) return;

  await exec
    .update(crmHouseholds)
    .set({ name: newName, updatedAt: new Date() })
    .where(eq(crmHouseholds.id, householdId));
}
