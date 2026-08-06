import { db } from "@/db";
import { intakeForms, crmHouseholds, clients } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Client-uploaded intake documents.
 *
 * The public intake path has NO Clerk session, so this module cannot call
 * requireVaultAccess() or auth() the way src/lib/crm/documents.ts does. It
 * carries its own authorization instead — the caller (the route) has already
 * proven the identity gate — and reuses only the low-level primitives. This
 * mirrors the portal-vault precedent (src/lib/portal/vault-documents.ts):
 * a thin parallel module beats making audited advisor code dual-tenant.
 */

/** Household display name for a prospect whose real contacts don't exist yet.
 *  applyIntake later overwrites this via syncHouseholdNameFromContacts. */
export function placeholderHouseholdName(
  recipientName: string | null,
  recipientEmail: string,
): string {
  const trimmed = recipientName?.trim();
  if (trimmed) return `${trimmed} Household`;
  return `${recipientEmail.split("@")[0]} Household`;
}

/**
 * Resolve the household an intake form's documents belong to, minting one for a
 * prospect form on first use.
 *
 * The whole thing runs under a row lock on the form. Intake decision D6 gives
 * client and spouse ONE shared token, so two simultaneous first uploads are a
 * real scenario — without the lock they would mint two households for one form.
 * The loser blocks, then observes the winner's id under `crmHouseholdId`.
 */
export async function resolveIntakeHousehold(formId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({
        firmId: intakeForms.firmId,
        clientId: intakeForms.clientId,
        crmHouseholdId: intakeForms.crmHouseholdId,
        createdByUserId: intakeForms.createdByUserId,
        recipientName: intakeForms.recipientName,
        recipientEmail: intakeForms.recipientEmail,
      })
      .from(intakeForms)
      .where(eq(intakeForms.id, formId))
      .for("update");

    if (!form) throw new Error(`Intake form ${formId} not found`);

    // Existing client: the household already exists; never park it on the form.
    if (form.clientId) {
      const [client] = await tx
        .select({ crmHouseholdId: clients.crmHouseholdId })
        .from(clients)
        .where(eq(clients.id, form.clientId));
      if (!client?.crmHouseholdId) {
        throw new Error(`Client ${form.clientId} has no CRM household`);
      }
      return client.crmHouseholdId;
    }

    if (form.crmHouseholdId) return form.crmHouseholdId;

    const [household] = await tx
      .insert(crmHouseholds)
      .values({
        firmId: form.firmId,
        advisorId: form.createdByUserId,
        name: placeholderHouseholdName(form.recipientName, form.recipientEmail),
        // false so applyIntake's syncHouseholdNameFromContacts re-derives the
        // real name from actual contacts — the placeholder must not stick.
        nameIsCustom: false,
        // status defaults to "prospect" — correct for this path.
      })
      .returning({ id: crmHouseholds.id });

    await tx
      .update(intakeForms)
      .set({ crmHouseholdId: household.id, updatedAt: new Date() })
      .where(eq(intakeForms.id, formId));

    return household.id;
  });
}
