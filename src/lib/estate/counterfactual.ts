/**
 * Synthesizes a "no-plan" counterfactual ClientData by:
 *   1. Reassigning every trust-owned account_owners slice back to the trust's grantor family member
 *   2. Dropping all gift events targeting trusts — BOTH `gifts` (authored rows)
 *      and `giftEvents` (what the engine consumes)
 *   3. Dropping all bequests targeting trusts (filtering nested recipients)
 *
 * Gifts to people and gifts to charities are preserved — those happen in any plan.
 *
 * Third-party-grantor trusts: a trust whose `grantor` does not resolve to a
 * `FamilyMember` keeps its authored owner row unchanged, and we warn. We do NOT
 * drop the slice (that left percents summing to <1 and threw on the next
 * `ownersForYear` read — the whole page 500'd) and we do NOT re-normalize the
 * survivors (that silently reassigns a third party's slice to the household).
 * The counterfactual's job is to remove the PLAN, not to invent ownership. The
 * cost is that such a slice stays out-of-estate in a no-trust scenario, which
 * the warning makes visible.
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

  // Trusts we could not resolve a grantor for. Their slices stay ON the
  // account exactly as authored — see the note in the docblock.
  const unresolvedTrusts = new Set<string>();

  const remapOwners = (owners: AccountOwner[]): AccountOwner[] => {
    const next: AccountOwner[] = [];
    for (const owner of owners) {
      if (owner.kind === "entity" && trustIds.has(owner.entityId)) {
        const grantorFmId = trustToGrantorFm.get(owner.entityId);
        if (grantorFmId) {
          next.push({
            kind: "family_member",
            familyMemberId: grantorFmId,
            percent: owner.percent,
          });
        } else {
          // Third-party-grantor trust: keep the authored row. Dropping it left
          // percents summing to <1 and threw on the next ownersForYear read;
          // re-normalizing would hand a third party's slice to the household.
          unresolvedTrusts.add(owner.entityId);
          next.push(owner);
        }
      } else {
        next.push(owner);
      }
    }
    return collapseOwners(next);
  };

  const newAccounts = tree.accounts.map((account) => ({
    ...account,
    owners: remapOwners(account.owners),
  }));

  const newLiabilities = tree.liabilities.map((liab) => ({
    ...liab,
    owners: remapOwners(liab.owners ?? []),
  }));

  const newGifts = (tree.gifts ?? []).filter(
    (g) => !(g.recipientEntityId && trustIds.has(g.recipientEntityId)),
  );

  // `giftEvents` is the field the ENGINE consumes; `gifts` above is the
  // authored row list. Filtering only `gifts` left the trust-directed event in
  // place, and it re-applied the very slice this function just handed back to
  // the grantor — so the "no plan" baseline reproduced the plan exactly and
  // every delta read ~$0. Same predicate as `gifts`: trust-directed only. Gifts
  // to people and charities are preserved; those happen in any plan.
  const newGiftEvents = (tree.giftEvents ?? []).filter(
    (e) => !(e.recipientEntityId && trustIds.has(e.recipientEntityId)),
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

  for (const entityId of unresolvedTrusts) {
    console.warn(
      `synthesizeNoPlanClientData: trust ${entityId} has no resolvable grantor; ` +
        `its ownership slice stays out-of-estate in the no-plan baseline.`,
    );
  }

  return {
    ...tree,
    accounts: newAccounts,
    liabilities: newLiabilities,
    gifts: newGifts,
    giftEvents: newGiftEvents,
    wills: newWills,
  };
}

function collapseOwners(owners: AccountOwner[]): AccountOwner[] {
  const map = new Map<string, AccountOwner>();
  for (const owner of owners) {
    const key =
      owner.kind === "family_member"
        ? `fm:${owner.familyMemberId}`
        : owner.kind === "entity"
          ? `e:${owner.entityId}`
          : owner.kind === "gifted_away"
            ? `ga:${owner.recipient.kind}:${owner.recipient.id}`
            : `xb:${owner.externalBeneficiaryId}`;
    const existing = map.get(key);
    if (existing) {
      map.set(key, { ...existing, percent: existing.percent + owner.percent });
    } else {
      map.set(key, owner);
    }
  }
  return Array.from(map.values());
}
