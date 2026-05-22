import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";

// Drizzle transaction handle — same convention used in src/lib/ownership.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Pushes any identity + contact fields in the patch through to the CRM
 * household contacts. Splits the patch into the primary contact
 * (firstName/lastName/dateOfBirth/email/address) and the spouse contact
 * (spouseName/spouseEmail/...). Address is a single legacy text blob; we drop
 * it into addressLine1 and leave the other parts null — the CRM contact form
 * can re-parse later.
 *
 * Shared between PUT /api/clients/[id] (where it's the canonical identity
 * write path) and POST /api/clients (where it mirrors contact-only fields on
 * create). Both call sites pass a transaction handle so the CRM write is
 * atomic with the clients-row mutation.
 *
 * Spouse patch is UPDATE-only: silently no-ops if the household has no spouse
 * contact row — the caller is responsible for inserting one when needed.
 */
export async function mirrorContactToCrm(
  tx: Tx,
  crmHouseholdId: string,
  safeUpdate: Record<string, unknown>,
): Promise<void> {
  // Primary contact patch.
  const primaryPatch: Record<string, unknown> = {};
  if ("firstName" in safeUpdate) primaryPatch.firstName = safeUpdate.firstName;
  if ("lastName" in safeUpdate) primaryPatch.lastName = safeUpdate.lastName;
  if ("dateOfBirth" in safeUpdate) primaryPatch.dateOfBirth = safeUpdate.dateOfBirth;
  if ("email" in safeUpdate) primaryPatch.email = safeUpdate.email ?? null;
  if ("phone" in safeUpdate) primaryPatch.phone = safeUpdate.phone ?? null;
  if ("mobile" in safeUpdate) primaryPatch.mobile = safeUpdate.mobile ?? null;
  if ("addressLine1" in safeUpdate) primaryPatch.addressLine1 = safeUpdate.addressLine1 ?? null;
  else if ("address" in safeUpdate) primaryPatch.addressLine1 = safeUpdate.address ?? null;
  if ("addressLine2" in safeUpdate) primaryPatch.addressLine2 = safeUpdate.addressLine2 ?? null;
  if ("city" in safeUpdate) primaryPatch.city = safeUpdate.city ?? null;
  if ("state" in safeUpdate) primaryPatch.state = safeUpdate.state ?? null;
  if ("postalCode" in safeUpdate) primaryPatch.postalCode = safeUpdate.postalCode ?? null;
  if ("country" in safeUpdate) primaryPatch.country = safeUpdate.country ?? null;
  if (Object.keys(primaryPatch).length > 0) {
    primaryPatch.updatedAt = new Date();
    await tx
      .update(crmHouseholdContacts)
      .set(primaryPatch)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, crmHouseholdId),
          eq(crmHouseholdContacts.role, "primary"),
        ),
      );
  }

  // Spouse contact patch — UPDATE only; skip silently if no spouse row exists.
  const spousePatch: Record<string, unknown> = {};
  if ("spouseName" in safeUpdate) spousePatch.firstName = safeUpdate.spouseName;
  if ("spouseLastName" in safeUpdate) spousePatch.lastName = safeUpdate.spouseLastName;
  if ("spouseDob" in safeUpdate) spousePatch.dateOfBirth = safeUpdate.spouseDob;
  if ("spouseEmail" in safeUpdate) spousePatch.email = safeUpdate.spouseEmail ?? null;
  if ("spousePhone" in safeUpdate) spousePatch.phone = safeUpdate.spousePhone ?? null;
  if ("spouseMobile" in safeUpdate) spousePatch.mobile = safeUpdate.spouseMobile ?? null;
  if ("spouseAddressLine1" in safeUpdate) spousePatch.addressLine1 = safeUpdate.spouseAddressLine1 ?? null;
  else if ("spouseAddress" in safeUpdate) spousePatch.addressLine1 = safeUpdate.spouseAddress ?? null;
  if ("spouseAddressLine2" in safeUpdate) spousePatch.addressLine2 = safeUpdate.spouseAddressLine2 ?? null;
  if ("spouseCity" in safeUpdate) spousePatch.city = safeUpdate.spouseCity ?? null;
  if ("spouseState" in safeUpdate) spousePatch.state = safeUpdate.spouseState ?? null;
  if ("spousePostalCode" in safeUpdate) spousePatch.postalCode = safeUpdate.spousePostalCode ?? null;
  if ("spouseCountry" in safeUpdate) spousePatch.country = safeUpdate.spouseCountry ?? null;
  if (Object.keys(spousePatch).length > 0) {
    spousePatch.updatedAt = new Date();
    await tx
      .update(crmHouseholdContacts)
      .set(spousePatch)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, crmHouseholdId),
          eq(crmHouseholdContacts.role, "spouse"),
        ),
      );
  }
}
