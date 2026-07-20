import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { deriveHouseholdNameFromContacts } from "./household-name";

// Drizzle transaction handle — same convention as src/lib/clients/mirror-contact-to-crm.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Accepts either the base db or a transaction so callers can run inside or
// outside an existing transaction.
type Executor = typeof db | Tx;

export type SyncHouseholdNameOutcome =
  | "updated"
  | "unchanged"
  | "locked"
  | "no-primary";

export interface SyncHouseholdNameResult {
  outcome: SyncHouseholdNameOutcome;
  /** The household's effective name after the sync. null when the row is gone. */
  name: string | null;
}

/**
 * Reads a household's contacts and returns the name they derive to, or null
 * when there is no primary contact to derive from. Does not write.
 */
export async function deriveNameForHousehold(
  exec: Executor,
  householdId: string,
): Promise<string | null> {
  const contacts = await exec
    .select({
      role: crmHouseholdContacts.role,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
    })
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, householdId));

  return deriveHouseholdNameFromContacts(contacts);
}

/**
 * Overwrites a CRM household's denormalized `name` column to match its current
 * contacts. Call this AFTER the contact rows have been updated.
 *
 * The household name tracks its primary/spouse contacts automatically UNLESS
 * `nameIsCustom` is set — the advisor ticked "Use a custom name", and their
 * name is frozen until they untick it. That check happens first, so a locked
 * household is never read past.
 *
 * `updateCrmHousehold` (src/lib/crm/households.ts) checks this same lock
 * inline instead of calling this helper. The two checks must stay in
 * lockstep if the locking rule ever changes.
 */
export async function syncHouseholdNameFromContacts(
  exec: Executor,
  householdId: string,
): Promise<SyncHouseholdNameResult> {
  const [household] = await exec
    .select({ name: crmHouseholds.name, nameIsCustom: crmHouseholds.nameIsCustom })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, householdId));

  // Household is gone (raced with a delete). Nothing to update, nothing to say.
  if (!household) return { outcome: "unchanged", name: null };

  if (household.nameIsCustom) {
    return { outcome: "locked", name: household.name };
  }

  const newName = await deriveNameForHousehold(exec, householdId);
  if (newName == null) {
    return { outcome: "no-primary", name: household.name };
  }
  if (household.name === newName) {
    return { outcome: "unchanged", name: household.name };
  }

  await exec
    .update(crmHouseholds)
    .set({ name: newName, updatedAt: new Date() })
    .where(eq(crmHouseholds.id, householdId));

  return { outcome: "updated", name: newName };
}
