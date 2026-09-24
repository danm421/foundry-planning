/** Build recipient fields for a PATCH body when the recipient kind may have changed.
 *
 * When a gift's recipient kind changes (e.g., entity → family_member), the dialog must
 * send ALL THREE recipient columns with explicit nulls for the fields that no longer apply.
 * Without the nulls, the stale recipient survives on the parent row, creating a dual-recipient
 * violation of the `gifts_recipient_exactly_one` CHECK.
 *
 * This applies only to PATCH (in-place) bodies. POST bodies create new rows and need no nulls. */
export function buildRecipientPatchFields(recipient: {
  kind: "entity" | "family_member" | "external_beneficiary";
  id: string;
}): Record<string, string | null> {
  return {
    recipientEntityId: recipient.kind === "entity" ? recipient.id : null,
    recipientFamilyMemberId: recipient.kind === "family_member" ? recipient.id : null,
    recipientExternalBeneficiaryId: recipient.kind === "external_beneficiary" ? recipient.id : null,
  };
}
