import type { Account, ClientData, EntitySummary, Gift } from "@/engine/types";

/** A revocable living trust already present in base facts, with the accounts
 *  currently titled into it. Derived from the `account.revocableTrustName` tag. */
export interface CurrentRevocableTrust {
  name: string;
  accountNames: string[];
}

/** Group base accounts that are already tagged into a revocable living trust by
 *  trust name. Untagged accounts (revocableTrustName == null) are ignored. */
export function currentRevocableTrusts(accounts: Account[]): CurrentRevocableTrust[] {
  const byName = new Map<string, string[]>();
  for (const a of accounts) {
    const name = a.revocableTrustName;
    if (name == null) continue;
    const list = byName.get(name) ?? [];
    list.push(a.name);
    byName.set(name, list);
  }
  return [...byName.entries()].map(([name, accountNames]) => ({ name, accountNames }));
}

/** True for trust-kind entities (vs. business entities like LLC / S-corp). */
export function isTrustEntity(e: EntitySummary): boolean {
  return e.entityType === "trust" || e.trustSubType != null;
}

/** Existing trust entities from base facts. */
export function currentTrustEntities(
  entities: EntitySummary[] | undefined,
): EntitySummary[] {
  return (entities ?? []).filter(isTrustEntity);
}

export interface CurrentCharity {
  id: string;
  name: string;
  charityType: "public" | "private";
}

/** Existing charity beneficiaries from base facts (drops individuals). */
export function currentCharities(
  beneficiaries: ClientData["externalBeneficiaries"],
): CurrentCharity[] {
  return (beneficiaries ?? [])
    .filter((b) => b.kind === "charity")
    .map((b) => ({ id: b.id, name: b.name, charityType: b.charityType }));
}

/** One-line read-only label for an existing base cash gift. */
export function summarizeCurrentGift(g: Gift, clientData: ClientData): string {
  const recipient = currentGiftRecipientName(g, clientData);
  const amount = `$${Math.round(g.amount).toLocaleString("en-US")}`;
  return recipient
    ? `Cash gift ${g.year}: ${amount} → ${recipient}`
    : `Cash gift ${g.year}: ${amount}`;
}

function currentGiftRecipientName(g: Gift, clientData: ClientData): string | null {
  if (g.recipientEntityId) {
    return clientData.entities?.find((e) => e.id === g.recipientEntityId)?.name ?? null;
  }
  if (g.recipientFamilyMemberId) {
    const fm = clientData.familyMembers?.find((m) => m.id === g.recipientFamilyMemberId);
    if (!fm) return null;
    return `${fm.firstName} ${fm.lastName ?? ""}`.trim() || null;
  }
  if (g.recipientExternalBeneficiaryId) {
    return (
      clientData.externalBeneficiaries?.find((b) => b.id === g.recipientExternalBeneficiaryId)
        ?.name ?? null
    );
  }
  return null;
}
