import type { EntitySummary } from "@/engine/types";

/**
 * Number of trust beneficiaries holding a Crummey withdrawal power, used as the
 * annual-exclusion multiplier (`annualExclusion × count`). Per spec decision:
 * all natural persons across primary AND contingent tiers, excluding sub-trust
 * (`entityIdRef`) beneficiaries.
 */
export function crummeyBeneficiaryCount(
  entity: Pick<EntitySummary, "beneficiaries">,
): number {
  return (entity.beneficiaries ?? []).filter(
    (b) =>
      b.entityIdRef == null &&
      (b.familyMemberId != null ||
        b.externalBeneficiaryId != null ||
        b.householdRole != null),
  ).length;
}
