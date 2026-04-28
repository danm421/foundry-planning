/**
 * Synthesizes a "no-plan" counterfactual ClientData by:
 *   1. Reassigning every trust-owned account_owners slice back to the trust's grantor family member
 *   2. Dropping all gift events targeting trusts
 *   3. Dropping all bequests targeting trusts (filtering nested recipients)
 *
 * Gifts to people and gifts to charities are preserved — those happen in any plan.
 */

import type { AccountOwner } from "@/engine/ownership";
import type { ClientData } from "@/engine/types";

export function synthesizeNoPlanClientData(tree: ClientData): ClientData {
  const trustIds = new Set(
    (tree.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );

  const trustToGrantorFm = new Map<string, string>();
  for (const entity of tree.entities ?? []) {
    if (entity.entityType !== "trust" || !entity.grantor) continue;
    const grantorFm = (tree.familyMembers ?? []).find(
      (fm) => fm.role === entity.grantor,
    );
    if (grantorFm) {
      trustToGrantorFm.set(entity.id, grantorFm.id);
    }
  }

  const newAccounts = tree.accounts.map((account) => {
    const newOwners: AccountOwner[] = [];
    for (const owner of account.owners) {
      if (owner.kind === "entity" && trustIds.has(owner.entityId)) {
        const grantorFmId = trustToGrantorFm.get(owner.entityId);
        if (grantorFmId) {
          newOwners.push({
            kind: "family_member",
            familyMemberId: grantorFmId,
            percent: owner.percent,
          });
        }
        // Trust without a grantor (third-party-grantor) — drop the slice silently.
      } else {
        newOwners.push(owner);
      }
    }
    return { ...account, owners: collapseOwners(newOwners) };
  });

  const newGifts = (tree.gifts ?? []).filter(
    (g) => !(g.recipientEntityId && trustIds.has(g.recipientEntityId)),
  );

  // WillBequest holds an array of recipients with { recipientKind, recipientId }.
  // Drop any recipient that targets a trust; if a bequest is left with no
  // recipients (i.e. it targeted only trusts), drop the bequest entirely.
  const newWills = (tree.wills ?? []).map((will) => ({
    ...will,
    bequests: (will.bequests ?? [])
      .map((bequest) => ({
        ...bequest,
        recipients: bequest.recipients.filter(
          (r) =>
            !(
              r.recipientKind === "entity" &&
              r.recipientId !== null &&
              trustIds.has(r.recipientId)
            ),
        ),
      }))
      .filter((bequest) => bequest.recipients.length > 0),
  }));

  const newLiabilities = tree.liabilities.map((liab) => {
    const newOwners: AccountOwner[] = [];
    for (const owner of liab.owners ?? []) {
      if (owner.kind === "entity" && trustIds.has(owner.entityId)) {
        const grantorFmId = trustToGrantorFm.get(owner.entityId);
        if (grantorFmId) {
          newOwners.push({
            kind: "family_member",
            familyMemberId: grantorFmId,
            percent: owner.percent,
          });
        }
      } else {
        newOwners.push(owner);
      }
    }
    return { ...liab, owners: collapseOwners(newOwners) };
  });

  return {
    ...tree,
    accounts: newAccounts,
    liabilities: newLiabilities,
    gifts: newGifts,
    wills: newWills,
  };
}

function collapseOwners(owners: AccountOwner[]): AccountOwner[] {
  const map = new Map<string, AccountOwner>();
  for (const owner of owners) {
    const key =
      owner.kind === "family_member"
        ? `fm:${owner.familyMemberId}`
        : `e:${owner.entityId}`;
    const existing = map.get(key);
    if (existing) {
      map.set(key, { ...existing, percent: existing.percent + owner.percent });
    } else {
      map.set(key, owner);
    }
  }
  return Array.from(map.values());
}
