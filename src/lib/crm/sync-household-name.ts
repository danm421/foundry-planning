import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { deriveHouseholdNameFromContacts } from "./household-name";

// Drizzle transaction handle — same convention as src/lib/clients/mirror-contact-to-crm.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Accepts either the base db or a transaction so callers can run inside or
// outside an existing transaction.
type Executor = typeof db | Tx;

/**
 * Overwrites a CRM household's denormalized `name` column to match its current
 * contacts. Call this AFTER the contact rows have been updated, when a name
 * field changed.
 *
 * Per the 2026-06-29 decision the household name ALWAYS tracks the clients —
 * there is no custom-name protection. A name the advisor typed by hand in the
 * CRM will be overwritten on the next client-name edit. No-ops when the
 * household is gone, has no primary contact, or the name is already correct.
 */
export async function syncHouseholdNameFromContacts(
  exec: Executor,
  householdId: string,
): Promise<void> {
  const contacts = await exec
    .select({
      role: crmHouseholdContacts.role,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
    })
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, householdId));

  const newName = deriveHouseholdNameFromContacts(contacts);
  if (newName == null) return;

  const [household] = await exec
    .select({ name: crmHouseholds.name })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, householdId));
  if (!household || household.name === newName) return;

  await exec
    .update(crmHouseholds)
    .set({ name: newName, updatedAt: new Date() })
    .where(eq(crmHouseholds.id, householdId));
}
