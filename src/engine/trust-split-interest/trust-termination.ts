import type { BeneficiaryRef, EntitySummary } from "@/engine/types";

export interface TerminationDeathYears {
  client?: number;
  spouse?: number;
  measuringLife1?: number;
  measuringLife2?: number;
}

export interface TerminationContext {
  trust: EntitySummary;
  currentYear: number;
  designations: BeneficiaryRef[];
}

export interface TrustTerminationResult {
  trustId: string;
  trustName: string;
  totalDistributed: number;
  toBeneficiaries: Array<{
    designationId: string;
    recipientLabel: string;
    familyMemberId?: string;
    externalBeneficiaryId?: string;
    amount: number;
  }>;
}

/**
 * Returns true when `currentYear` is the year-after-term-end for this CLUT.
 * For 'years' termType: inceptionYear + termYears.
 * For 'single_life': measuringLife1 death year + 1.
 * For 'joint_life': max(both deaths) + 1 (term ends at second death).
 * For 'shorter_of_years_or_life': min(years-end, life-end) of whichever leg
 *   fired first; if no death yet, falls through to the years leg.
 */
export function isTrustTerminationYear(
  trust: EntitySummary,
  currentYear: number,
  deathYears: TerminationDeathYears,
): boolean {
  if (trust.trustSubType !== "clut" || !trust.splitInterest) return false;
  const si = trust.splitInterest;
  switch (si.termType) {
    case "years":
      return currentYear === si.inceptionYear + (si.termYears ?? 0);
    case "single_life":
      return (
        deathYears.measuringLife1 != null &&
        currentYear === deathYears.measuringLife1 + 1
      );
    case "joint_life": {
      const d1 = deathYears.measuringLife1;
      const d2 = deathYears.measuringLife2;
      if (d1 == null || d2 == null) return false;
      return currentYear === Math.max(d1, d2) + 1;
    }
    case "shorter_of_years_or_life": {
      const yearsEnd = si.inceptionYear + (si.termYears ?? 0);
      const lifeDeath = deathYears.measuringLife1;
      const lifeEnd = lifeDeath != null ? lifeDeath + 1 : Infinity;
      return currentYear === Math.min(yearsEnd, lifeEnd);
    }
    default:
      return false;
  }
}

/**
 * Distributes the trust's remaining assets to primary remainder beneficiaries
 * by percentage. Caller is responsible for actually moving the assets — this
 * function only computes the bookkeeping breakdown. Rounding drift (sub-cent)
 * is reconciled to the largest share.
 */
export function distributeAtTermination(
  ctx: TerminationContext,
  totalAvailable: number,
): TrustTerminationResult {
  const primaries = ctx.designations.filter((d) => d.tier === "primary");
  if (primaries.length === 0) {
    return {
      trustId: ctx.trust.id,
      trustName: ctx.trust.name ?? ctx.trust.id,
      totalDistributed: totalAvailable,
      toBeneficiaries: [],
    };
  }
  const totalPct = primaries.reduce((s, d) => s + Number(d.percentage), 0);
  const toBeneficiaries = primaries.map((d) => {
    const amount = round2(totalAvailable * (Number(d.percentage) / totalPct));
    return {
      designationId: d.id,
      recipientLabel: labelFor(d),
      familyMemberId: d.familyMemberId,
      externalBeneficiaryId: d.externalBeneficiaryId,
      amount,
    };
  });

  const distributed = toBeneficiaries.reduce((s, b) => s + b.amount, 0);
  const drift = round2(totalAvailable - distributed);
  if (drift !== 0 && toBeneficiaries.length > 0) {
    const i = toBeneficiaries.reduce(
      (max, b, idx, arr) => (b.amount > arr[max].amount ? idx : max),
      0,
    );
    toBeneficiaries[i] = {
      ...toBeneficiaries[i],
      amount: round2(toBeneficiaries[i].amount + drift),
    };
  }

  return {
    trustId: ctx.trust.id,
    trustName: ctx.trust.name ?? ctx.trust.id,
    totalDistributed: totalAvailable,
    toBeneficiaries,
  };
}

function labelFor(d: BeneficiaryRef): string {
  if (d.familyMemberId) return `Family member ${d.familyMemberId}`;
  if (d.externalBeneficiaryId)
    return `External beneficiary ${d.externalBeneficiaryId}`;
  return `Designation ${d.id}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
