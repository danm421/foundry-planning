import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { willBequestRecipients, willResiduaryRecipients } from "@/db/schema";

/** Inferred from db.transaction callback to avoid coupling to internal Drizzle generics. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Will-recipient kinds whose `recipient_id` references another table. `spouse`
 * is excluded because its `recipient_id` is always null (resolved by role at
 * projection time), so it can never dangle.
 */
export type DanglingWillRecipientKind =
  | "family_member"
  | "external_beneficiary"
  | "entity";

/**
 * Deletes the bequest + residuary will-recipient rows that point at a recipient
 * entity being deleted (audit F13).
 *
 * `will_bequest_recipients.recipient_id` / `will_residuary_recipients.recipient_id`
 * are polymorphic raw UUIDs dispatched by `recipient_kind` with no foreign key,
 * so a plain delete of the referenced family member / external beneficiary /
 * entity would leave a dangling id and silently wrong estate projections. Call
 * this inside the same transaction as the entity delete so the cleanup is atomic.
 */
export async function cleanupWillRecipientReferences(
  tx: Tx,
  kind: DanglingWillRecipientKind,
  recipientId: string,
): Promise<void> {
  await tx
    .delete(willBequestRecipients)
    .where(
      and(
        eq(willBequestRecipients.recipientKind, kind),
        eq(willBequestRecipients.recipientId, recipientId),
      ),
    );
  await tx
    .delete(willResiduaryRecipients)
    .where(
      and(
        eq(willResiduaryRecipients.recipientKind, kind),
        eq(willResiduaryRecipients.recipientId, recipientId),
      ),
    );
}
