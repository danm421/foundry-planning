export type Tier = "primary" | "contingent" | "income" | "remainder";

export type DesignationInput = {
  tier: Tier;
  percentage: number;
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  entityIdRef?: string | null;
  householdRole?: string | null;
};

type Result = { ok: true } | { ok: false; errors: string[] };

const TIERS: Tier[] = ["primary", "contingent", "income", "remainder"];
const SUM_TOLERANCE = 0.01;

export function validateBeneficiarySplit(ds: DesignationInput[]): Result {
  const errors: string[] = [];

  for (const d of ds) {
    if (!(d.percentage > 0) || d.percentage > 100) {
      errors.push(
        `Percentage must be > 0 and <= 100 (got ${d.percentage} in ${d.tier} tier).`
      );
    }
  }

  for (const tier of TIERS) {
    const inTier = ds.filter((d) => d.tier === tier);
    if (inTier.length === 0) continue;

    const seen = new Set<string>();
    for (const d of inTier) {
      const key = d.familyMemberId
        ? `fm:${d.familyMemberId}`
        : d.externalBeneficiaryId
          ? `ext:${d.externalBeneficiaryId}`
          : d.entityIdRef
            ? `entity:${d.entityIdRef}`
            : d.householdRole
              ? `role:${d.householdRole}`
              : null;
      if (key === null) continue; // Zod layer enforces "exactly one" ref.
      if (seen.has(key)) {
        errors.push(`Duplicate beneficiary in ${tier} tier.`);
      }
      seen.add(key);
    }

    const sum = inTier.reduce((acc, d) => acc + d.percentage, 0);
    if (Math.abs(sum - 100) > SUM_TOLERANCE) {
      errors.push(
        `${tier} percentages must sum to 100 (got ${sum.toFixed(2)}).`
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
