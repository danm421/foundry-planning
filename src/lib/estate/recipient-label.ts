import type { ClientData, DeathTransfer } from "@/engine/types";

export interface ResolvedRecipientLabel {
  /** Display name (already humanized). */
  name: string;
  /** Echoes the underlying transfer.recipientKind for pivoting downstream. */
  kind: DeathTransfer["recipientKind"];
  /** Family-member relationship, mapped to null for "other". Null for non-family. */
  relationship: string | null;
  /** True when the recipient is an entity (rendered as "<name> remainder"). */
  isTrustRemainder: boolean;
}

/**
 * Resolve a death-transfer's recipient into a display label, joining against
 * the current ClientData tree (familyMembers / entities / externalBeneficiaries).
 *
 * Falls back to the transfer's frozen `recipientLabel` when the joined record
 * is missing — the ledger's label is the canonical "what the engine saw at
 * event time" name, so it stays correct even when the tree has drifted.
 */
export function resolveRecipientLabel(
  transfer: DeathTransfer,
  clientData: ClientData,
): ResolvedRecipientLabel {
  const { recipientKind, recipientId, recipientLabel } = transfer;

  if (recipientKind === "family_member" && recipientId) {
    const fm = (clientData.familyMembers ?? []).find((f) => f.id === recipientId);
    if (fm) {
      const name = `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
      const relationship = fm.relationship === "other" ? null : fm.relationship;
      return { name, kind: recipientKind, relationship, isTrustRemainder: false };
    }
  }

  if (recipientKind === "entity" && recipientId) {
    const ent = (clientData.entities ?? []).find((e) => e.id === recipientId);
    const name = ent?.name ? `${ent.name} remainder` : `${recipientLabel} remainder`;
    return { name, kind: recipientKind, relationship: null, isTrustRemainder: true };
  }

  if (recipientKind === "external_beneficiary" && recipientId) {
    const ext = (clientData.externalBeneficiaries ?? []).find((e) => e.id === recipientId);
    if (ext) {
      return { name: ext.name, kind: recipientKind, relationship: null, isTrustRemainder: false };
    }
  }

  // F2: prefer recipientId when present — it carries the actual surviving
  // FM id (set by applyTitling/applyFallback/will-bequest emission since
  // 2026-05-01). Without this, spouseFirst ordering mislabels the surviving
  // client as the spouse because the role-based fallback always returns
  // the spouse FM.
  //
  // Falls back to the legacy role-based lookup when:
  //   - recipientId is null (final-death will bequests with no surviving spouse)
  //   - recipientId points at an FM no longer in the tree (data drift)
  if (recipientKind === "spouse") {
    if (recipientId) {
      const fm = (clientData.familyMembers ?? []).find((f) => f.id === recipientId);
      if (fm) {
        const name = `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
        return { name, kind: recipientKind, relationship: null, isTrustRemainder: false };
      }
    }
    const spouseFm = (clientData.familyMembers ?? []).find((f) => f.role === "spouse");
    if (spouseFm) {
      const name = `${spouseFm.firstName}${spouseFm.lastName ? " " + spouseFm.lastName : ""}`;
      return { name, kind: recipientKind, relationship: null, isTrustRemainder: false };
    }
  }

  // system_default / unresolved → use the frozen label.
  return {
    name: recipientLabel,
    kind: recipientKind,
    relationship: null,
    isTrustRemainder: false,
  };
}
