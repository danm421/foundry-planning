import type { IrmaaTier, MedicareCoverage, MedicareYearDetail } from "./types";

/** Inputs for computing a single person's Medicare cost in a single year.
 *
 *  The caller is responsible for resolving the IRMAA 2-year lookback MAGI and
 *  the year-appropriate premium and bracket values. This function is pure: no
 *  framework or DB access, no I/O, and no hidden state.
 *
 *  Note on intentionally-unused inputs:
 *    - `owner` is part of the input shape so the caller can compose batched
 *      pipelines per-person without re-keying; the function itself doesn't
 *      branch on it.
 *    - `partDNationalBase` is reserved for Task 7 (projection integration),
 *      where Part D premiums may decompose into a national base plus the
 *      plan's marginal cost. The current dollar model lumps the plan portion
 *      into a single Medigap-style inflated number.
 */
export interface MedicareYearInput {
  year: number;
  owner: "client" | "spouse";
  age: number;
  coverage: MedicareCoverage;

  // Per-year resolved values supplied by caller (already inflated if year > seeded):
  standardPartBPremium: number;
  partDNationalBase: number;
  irmaaTiers: { mfj: IrmaaTier[]; single: IrmaaTier[] };
  filingStatus: "mfj" | "single";

  // 2-year-lookback MAGI:
  sourceMagi: number;
  sourceYearForIrmaa: number;
  isColdStart: boolean;

  // Inflation context for Medigap + Part D plan dollars:
  medicareBaseYear: number;
  medicarePremiumInflationRate: number;
  defaultMedigapMonthly: number;
  defaultPartDPlanMonthly: number;
}

const DEFAULT_ENROLLMENT_AGE = 65;

function inflatePremium(
  baseAmount: number,
  baseYear: number,
  targetYear: number,
  rate: number,
): number {
  const years = targetYear - baseYear;
  return baseAmount * Math.pow(1 + rate, years);
}

function pickTier(magi: number, tiers: IrmaaTier[]): {
  tier: number;
  surchargeB: number;
  surchargeD: number;
  upperBound: number | null;
} {
  for (const t of tiers) {
    const upperMatch = t.magiUpperBound === null || magi < t.magiUpperBound;
    if (magi >= t.magiLowerBound && upperMatch) {
      return {
        tier: t.tier,
        surchargeB: t.partBSurcharge,
        surchargeD: t.partDSurcharge,
        upperBound: t.magiUpperBound,
      };
    }
  }
  // Below tier 1 — implicit tier 0; headroom = distance to tier 1 entry.
  return { tier: 0, surchargeB: 0, surchargeD: 0, upperBound: tiers[0]?.magiLowerBound ?? null };
}

export function computeMedicareYear(input: MedicareYearInput): MedicareYearDetail {
  const {
    year, age, coverage,
    standardPartBPremium,
    irmaaTiers, filingStatus,
    sourceMagi, sourceYearForIrmaa, isColdStart,
    medicareBaseYear, medicarePremiumInflationRate,
    defaultMedigapMonthly, defaultPartDPlanMonthly,
  } = input;

  const enrollmentAge = DEFAULT_ENROLLMENT_AGE;
  const yearReachesEnrollmentYear =
    coverage.enrollmentYear === null || year >= coverage.enrollmentYear;
  const enrolled = age >= enrollmentAge && yearReachesEnrollmentYear;

  if (!enrolled) {
    return {
      enrolled: false,
      age,
      partBPremium: 0,
      partBStandardPremium: 0,
      partBIrmaaSurcharge: 0,
      partDPremium: 0,
      partDIrmaaSurcharge: 0,
      medigapPremium: 0,
      totalAnnualCost: 0,
      sourceYearForIrmaa,
      sourceMagi,
      irmaaTier: 0,
      irmaaFilingStatus: filingStatus,
      headroomToNextTier: 0,
      isColdStart,
    };
  }

  const tiers = filingStatus === "mfj" ? irmaaTiers.mfj : irmaaTiers.single;
  const matched = pickTier(sourceMagi, tiers);

  const partBStandardPremium = standardPartBPremium;
  const partBIrmaaSurcharge = matched.surchargeB;
  const partBPremium = partBStandardPremium + partBIrmaaSurcharge;

  const baseMedigapMonthly = coverage.medigapMonthlyAt65 ?? defaultMedigapMonthly;
  const basePartDPlanMonthly = coverage.partDPlanMonthlyAt65 ?? defaultPartDPlanMonthly;

  const medigapPremium = inflatePremium(
    baseMedigapMonthly * 12, medicareBaseYear, year, medicarePremiumInflationRate,
  );
  const partDPlanAnnual = inflatePremium(
    basePartDPlanMonthly * 12, medicareBaseYear, year, medicarePremiumInflationRate,
  );
  const partDIrmaaSurcharge = matched.surchargeD;
  const partDPremium = partDPlanAnnual + partDIrmaaSurcharge;

  const totalAnnualCost = partBPremium + partDPremium + medigapPremium;

  const headroomToNextTier =
    matched.upperBound === null ? Infinity : Math.max(0, matched.upperBound - sourceMagi);

  return {
    enrolled: true,
    age,
    partBPremium,
    partBStandardPremium,
    partBIrmaaSurcharge,
    partDPremium,
    partDIrmaaSurcharge,
    medigapPremium,
    totalAnnualCost,
    sourceYearForIrmaa,
    sourceMagi,
    irmaaTier: matched.tier,
    irmaaFilingStatus: filingStatus,
    headroomToNextTier,
    isColdStart,
  };
}
