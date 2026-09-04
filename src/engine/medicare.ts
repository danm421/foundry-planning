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

// Engine purity rule prevents importing from src/lib — this mirrors
// DEFAULT_MEDICARE_ENROLLMENT_AGE in src/lib/medicare/constants.ts.
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
  // IRMAA tiers are MAGI > lower AND MAGI <= upper (20 CFR 418.2120): lower
  // EXCLUSIVE, upper INCLUSIVE. Adjacent tiers share a boundary value in the
  // seeded data, so a threshold-exact MAGI must stay in the LOWER tier.
  for (const t of tiers) {
    const lowerMatch = magi > t.magiLowerBound;
    const upperMatch = t.magiUpperBound === null || magi <= t.magiUpperBound;
    if (lowerMatch && upperMatch) {
      return {
        tier: t.tier,
        surchargeB: t.partBSurcharge,
        surchargeD: t.partDSurcharge,
        upperBound: t.magiUpperBound,
      };
    }
  }
  // MAGI at or below tier 1's lower bound — implicit tier 0 (standard premium);
  // headroom = distance to tier 1 entry.
  return { tier: 0, surchargeB: 0, surchargeD: 0, upperBound: tiers[0]?.magiLowerBound ?? null };
}

/**
 * The MAGI ceiling a conversion must not exceed to stay at or below `capTier`.
 *
 * ⚠️ ORIENTATION IS LOAD-BEARING, and it is the OPPOSITE of the tax-bracket
 * equivalent. IRMAA bounds are lower-EXCLUSIVE / upper-INCLUSIVE (20 CFR
 * 418.2120) — see `pickTier` above, which encodes the same convention. So a
 * MAGI landing exactly ON the tier-1 threshold is surcharge-free and the
 * tier-0 ceiling is that threshold ITSELF, with no backoff.
 *
 * Contrast `fillUpBracketCeiling` in roth-conversions.ts, which subtracts $1
 * precisely BECAUSE ordinary tax brackets are lower-inclusive and a base
 * landing on `tier.to` classifies into the NEXT bracket. Same shaped problem,
 * opposite correct answer; getting either backwards is wrong by a full tier
 * and looks entirely plausible on a report.
 *
 * Returns null when the tier is absent from the table, and for the TOP tier,
 * which is unbounded above and therefore cannot be a ceiling.
 */
export function irmaaCapCeiling(tiers: IrmaaTier[], capTier: number): number | null {
  if (capTier <= 0) return tiers[0]?.magiLowerBound ?? null;
  const tier = tiers.find((t) => t.tier === capTier);
  if (!tier) return null;
  return tier.magiUpperBound;
}

/** Scale every dollar figure on a tier table by `factor`. CMS republishes both
 *  the thresholds and the surcharges each year; the projection inflates them
 *  forward off the seeded row. Shared by the premium calculation and the
 *  conversion cap so the cap can never aim at a threshold the premium
 *  calculation does not use. */
export function inflateIrmaaTiers(tiers: IrmaaTier[], factor: number): IrmaaTier[] {
  if (factor === 1) return tiers;
  return tiers.map((t) => ({
    tier: t.tier,
    magiLowerBound: t.magiLowerBound * factor,
    magiUpperBound: t.magiUpperBound == null ? null : t.magiUpperBound * factor,
    partBSurcharge: t.partBSurcharge * factor,
    partDSurcharge: t.partDSurcharge * factor,
  }));
}

/** Whether `coverage`'s owner is enrolled in Medicare in `year`, given their
 *  age that year. Single definition shared by `computeMedicareYear` (which
 *  charges the premium) and the Roth-conversion IRMAA cap (which must not bind
 *  when nobody is enrolled in the premium year). */
export function isEnrolledInYear(
  coverage: MedicareCoverage,
  ageInYear: number,
  year: number,
): boolean {
  const reachesEnrollmentYear =
    coverage.enrollmentYear === null || year >= coverage.enrollmentYear;
  return ageInYear >= DEFAULT_ENROLLMENT_AGE && reachesEnrollmentYear;
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

  const enrolled = isEnrolledInYear(coverage, age, year);

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
      headroomToNextTier: Infinity,
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
