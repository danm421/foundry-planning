import type { BeneficiaryRef, EntitySummary } from "@/engine/types";

type HolderRef = Pick<
  BeneficiaryRef,
  "familyMemberId" | "externalBeneficiaryId" | "householdRole" | "otherHeirs"
>;

/**
 * Number of trust beneficiaries holding a Crummey withdrawal power, used as the
 * annual-exclusion multiplier (`annualExclusion × count`). Reads the trust's
 * lifetime (`incomeBeneficiaries`) people — no trust screen writes the
 * primary/contingent trust tiers — plus any legacy primary/contingent rows,
 * counting each person once. Skips sub-trusts, Other Heirs, charities
 * (`charityIds`) and the donor: a donor cannot hold a Crummey power over their
 * own gift, though for a client-funded SLAT the spouse still counts.
 */
export function crummeyBeneficiaryCount(
  entity: Pick<EntitySummary, "beneficiaries" | "incomeBeneficiaries">,
  opts: { donor?: "client" | "spouse"; charityIds?: ReadonlySet<string> } = {},
): number {
  const holderKey = (b: HolderRef, subTrustId: string | undefined): string | null => {
    if (subTrustId != null || b.otherHeirs) return null;
    if (b.familyMemberId != null) return `fm:${b.familyMemberId}`;
    if (b.externalBeneficiaryId != null) {
      return opts.charityIds?.has(b.externalBeneficiaryId) ? null : `ext:${b.externalBeneficiaryId}`;
    }
    if (b.householdRole != null && b.householdRole !== opts.donor) return `hh:${b.householdRole}`;
    return null;
  };

  const keys = [
    ...(entity.incomeBeneficiaries ?? []).map((b) => holderKey(b, b.entityId)),
    ...(entity.beneficiaries ?? []).map((b) => holderKey(b, b.entityIdRef)),
  ];
  return new Set(keys.filter((k) => k != null)).size;
}
