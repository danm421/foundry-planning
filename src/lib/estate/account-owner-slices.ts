import type { AccountOwner } from "@/engine/ownership";

export interface OwnerSlice {
  owner: AccountOwner;
  /** Dollar value of this owner's slice of the account at the resolved balance. */
  value: number;
}

/**
 * Split an account's resolved balance into per-owner dollar slices using the
 * engine's locked shares.
 *
 * An entity's slice is its locked EoY share (`entityAccountSharesEoY`) so
 * household cash flows on a split-owned account never bleed into the entity's
 * portion — the household drawdown lands on the family-member owners, who
 * share the residual `value − Σ entity slices`. A family member's slice uses
 * `familyAccountSharesEoY` when present (jointly-held drift), else its share
 * of the residual pool by relative percent.
 *
 * A `gifted_away` slice (a lifetime asset gift to a person or charity) holds
 * its own dollars — `value × percent` — and is subtracted from the family pool
 * so the remaining family members do NOT re-absorb what was given away. This
 * mirrors the death-time gross-estate math in
 * `engine/death-event/estate-tax.ts`, which subtracts `totalGiftedAway` from
 * its family pool for the same reason.
 *
 * Locked family shares are gift-blind: `computeFamilyAccountShares` seeds them
 * from the account's *authored* owners, so they still carry the pre-gift family
 * pool. They are scaled by `familyPool / familyPoolPreGift` — both dollar
 * figures, so the rescale stays consistent with an entity slice that has
 * drifted from its authored percent. With no gifted-away rows the two pools are
 * equal, the factor is 1, and locked shares pass through untouched.
 *
 * Falls back to `value × authoredPercent` when no locked-share data is
 * supplied (e.g. the as-of-today view, before any projected flows). This is
 * the same resolution the gross-estate and balance-sheet reports use.
 */
export function resolveOwnerSlices(
  accountId: string,
  owners: AccountOwner[],
  value: number,
  entityAccountSharesEoY?: Map<string, Map<string, number>>,
  familyAccountSharesEoY?: Map<string, Map<string, number>>,
): OwnerSlice[] {
  let totalEntityShare = 0;
  let familyPercentTotal = 0;
  let giftedAwayPercentTotal = 0;
  for (const o of owners) {
    if (o.kind === "entity") {
      const locked = entityAccountSharesEoY?.get(o.entityId)?.get(accountId);
      totalEntityShare += locked ?? value * o.percent;
    } else if (o.kind === "family_member") {
      familyPercentTotal += o.percent;
    } else if (o.kind === "gifted_away") {
      giftedAwayPercentTotal += o.percent;
    }
    // external_beneficiary rows carry no current balance-sheet value — they
    // describe death-benefit payouts, not present ownership.
  }
  const familyPoolPreGift = Math.max(0, value - totalEntityShare);
  const familyPool = Math.max(
    0,
    familyPoolPreGift - value * giftedAwayPercentTotal,
  );
  // Rescales gift-blind locked family shares onto the post-gift family pool.
  // Derived from the same dollar figures as `familyPool` so both branches of
  // the map below shrink by exactly the same amount.
  const lockedFmFactor =
    familyPoolPreGift > 0 ? familyPool / familyPoolPreGift : 1;

  return owners.map((owner) => {
    if (owner.kind === "entity") {
      const locked = entityAccountSharesEoY?.get(owner.entityId)?.get(accountId);
      return { owner, value: locked ?? value * owner.percent };
    }
    if (owner.kind === "external_beneficiary") {
      return { owner, value: 0 };
    }
    // Gifted away during life — out of the estate, but it still holds real
    // dollars on the recipient's side. Callers decide inclusion via
    // `inEstateWeight` / `outOfEstateWeight`, both of which weigh it 0.
    if (owner.kind === "gifted_away") {
      return { owner, value: value * owner.percent };
    }
    const lockedFm = familyAccountSharesEoY
      ?.get(owner.familyMemberId)
      ?.get(accountId);
    if (lockedFm != null) return { owner, value: lockedFm * lockedFmFactor };
    return {
      owner,
      value:
        familyPercentTotal > 0
          ? familyPool * (owner.percent / familyPercentTotal)
          : value * owner.percent,
    };
  });
}
