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
 * The year this CLT/CRT terminates — the year after its last payment — or
 * null while it cannot be known (a life leg whose measuring life has not died
 * within the plan; a non-split-interest entity).
 * For 'years' termType: inceptionYear + termYears.
 * For 'single_life': measuringLife1 death year + 1.
 * For 'joint_life': max(both deaths) + 1 (term ends at second death).
 * For 'shorter_of_years_or_life': min(years-end, life-end) of whichever leg
 *   fires first; with no death yet, the years leg.
 */
export function trustTerminationYear(
  trust: EntitySummary,
  deathYears: TerminationDeathYears,
): number | null {
  if (
    (trust.trustSubType !== "clt" && trust.trustSubType !== "crt") ||
    !trust.splitInterest
  ) {
    return null;
  }
  const si = trust.splitInterest;
  const yearsEnd = si.inceptionYear + (si.termYears ?? 0);
  switch (si.termType) {
    case "years":
      return yearsEnd;
    case "single_life":
      return deathYears.measuringLife1 != null
        ? deathYears.measuringLife1 + 1
        : null;
    case "joint_life": {
      const d1 = deathYears.measuringLife1;
      const d2 = deathYears.measuringLife2;
      if (d1 == null || d2 == null) return null;
      return Math.max(d1, d2) + 1;
    }
    case "shorter_of_years_or_life": {
      const lifeDeath = deathYears.measuringLife1;
      return lifeDeath != null ? Math.min(yearsEnd, lifeDeath + 1) : yearsEnd;
    }
    default:
      return null;
  }
}

/** True only in the termination year itself — the pass that pays out the
 *  remainder runs once. */
export function isTrustTerminationYear(
  trust: EntitySummary,
  currentYear: number,
  deathYears: TerminationDeathYears,
): boolean {
  return trustTerminationYear(trust, deathYears) === currentYear;
}

/** True from the termination year on — the trust makes no further payments
 *  and takes no further §642(c) deduction. */
export function hasTrustTerminated(
  trust: EntitySummary,
  currentYear: number,
  deathYears: TerminationDeathYears,
): boolean {
  const end = trustTerminationYear(trust, deathYears);
  return end != null && currentYear >= end;
}

export interface TerminationOptions {
  recipientMode?: "family" | "charity";
  /** Required when recipientMode === "charity". Single recipient id. */
  charityId?: string;
}

/**
 * Distributes the trust's remaining assets to primary remainder beneficiaries
 * by percentage. Caller is responsible for actually moving the assets — this
 * function only computes the bookkeeping breakdown. Rounding drift (sub-cent)
 * is reconciled to the largest share.
 *
 * When `options.recipientMode === "charity"`, the entire corpus is routed to
 * the named charity (CRT remainder path). All designations are ignored.
 */
export function distributeAtTermination(
  ctx: TerminationContext,
  totalAvailable: number,
  options: TerminationOptions = {},
): TrustTerminationResult {
  if (options.recipientMode === "charity") {
    if (!options.charityId) {
      throw new Error(
        "distributeAtTermination: charityId is required when recipientMode='charity'",
      );
    }
    return {
      trustId: ctx.trust.id,
      trustName: ctx.trust.name ?? ctx.trust.id,
      totalDistributed: totalAvailable,
      toBeneficiaries: [
        {
          designationId: `charity:${options.charityId}`,
          recipientLabel: `Charity ${options.charityId}`,
          externalBeneficiaryId: options.charityId,
          amount: totalAvailable,
        },
      ],
    };
  }

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
