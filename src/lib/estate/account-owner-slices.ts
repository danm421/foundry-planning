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
  for (const o of owners) {
    if (o.kind === "entity") {
      const locked = entityAccountSharesEoY?.get(o.entityId)?.get(accountId);
      totalEntityShare += locked ?? value * o.percent;
    } else if (o.kind === "family_member") {
      familyPercentTotal += o.percent;
    }
    // external_beneficiary rows carry no current balance-sheet value — they
    // describe death-benefit payouts, not present ownership.
  }
  const familyPool = Math.max(0, value - totalEntityShare);

  return owners.map((owner) => {
    if (owner.kind === "entity") {
      const locked = entityAccountSharesEoY?.get(owner.entityId)?.get(accountId);
      return { owner, value: locked ?? value * owner.percent };
    }
    if (owner.kind === "external_beneficiary") {
      return { owner, value: 0 };
    }
    // Gifted-away slices have left the estate — carry no present balance-sheet value.
    if (owner.kind === "gifted_away") {
      return { owner, value: 0 };
    }
    const lockedFm = familyAccountSharesEoY
      ?.get(owner.familyMemberId)
      ?.get(accountId);
    if (lockedFm != null) return { owner, value: lockedFm };
    return {
      owner,
      value:
        familyPercentTotal > 0
          ? familyPool * (owner.percent / familyPercentTotal)
          : value * owner.percent,
    };
  });
}
