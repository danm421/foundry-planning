import { survivalProbability, lx } from "@/engine/actuarial/mortality";

export type CrtWarningCode =
  | "payout_below_floor"
  | "payout_above_ceiling"
  | "mrit_below_floor"
  | "exhaustion_probability";

export interface CrtWarning {
  code: CrtWarningCode;
  message: string;
}

export interface CrtQualificationInput {
  inceptionValue: number;
  payoutType: "unitrust" | "annuity";
  payoutPercent: number | undefined;
  payoutAmount: number | undefined;
  irc7520Rate: number;
  termType: "years" | "single_life" | "joint_life" | "shorter_of_years_or_life";
  termYears: number | undefined;
  measuringLifeAge1: number | undefined;
  measuringLifeAge2: number | undefined;
  /** Charitable deduction computed by computeCrtInceptionInterests (= remainder PV). */
  charitableDeduction: number;
}

/**
 * Soft §664 qualification checks for a CRT. Returns an array of warnings.
 * Never throws; never blocks save. The form surfaces these inline so the
 * advisor can decide whether to revise or save anyway.
 */
export function computeCrtQualificationWarnings(
  input: CrtQualificationInput,
): CrtWarning[] {
  const warnings: CrtWarning[] = [];

  // 1. 5%–50% payout floor / ceiling.
  const payoutFraction = effectivePayoutFraction(input);
  if (payoutFraction != null) {
    if (payoutFraction < 0.05) {
      warnings.push({
        code: "payout_below_floor",
        message: "Payout is below the §664 5% floor.",
      });
    } else if (payoutFraction > 0.5) {
      warnings.push({
        code: "payout_above_ceiling",
        message: "Payout exceeds the §664 50% ceiling.",
      });
    }
  }

  // 2. 10% MRIT — remainder PV must be at least 10% of inception value.
  if (input.inceptionValue > 0) {
    const mritRatio = input.charitableDeduction / input.inceptionValue;
    if (mritRatio < 0.1) {
      warnings.push({
        code: "mrit_below_floor",
        message: "Fails the §664(d) 10% minimum remainder interest test.",
      });
    }
  }

  // 3. 5% probability of exhaustion — CRAT lifetime only (Rev. Rul. 77-374).
  if (
    input.payoutType === "annuity" &&
    isLifetimeTerm(input.termType) &&
    input.payoutAmount != null &&
    input.measuringLifeAge1 != null
  ) {
    const p = exhaustionProbability({
      inceptionValue: input.inceptionValue,
      annuity: input.payoutAmount,
      irc7520Rate: input.irc7520Rate,
      termType: input.termType as "single_life" | "joint_life" | "shorter_of_years_or_life",
      age1: input.measuringLifeAge1,
      age2: input.measuringLifeAge2,
      termYears: input.termYears,
    });
    if (p > 0.05) {
      warnings.push({
        code: "exhaustion_probability",
        message: `Fails the Rev. Rul. 77-374 5% probability-of-exhaustion test (≈${(p * 100).toFixed(1)}% chance of exhaustion).`,
      });
    }
  }

  return warnings;
}

function effectivePayoutFraction(input: CrtQualificationInput): number | null {
  if (input.payoutType === "unitrust") {
    return input.payoutPercent ?? null;
  }
  if (input.inceptionValue <= 0 || input.payoutAmount == null) return null;
  return input.payoutAmount / input.inceptionValue;
}

function isLifetimeTerm(t: CrtQualificationInput["termType"]): boolean {
  return t === "single_life" || t === "joint_life" || t === "shorter_of_years_or_life";
}

interface ExhaustionInput {
  inceptionValue: number;
  annuity: number;
  irc7520Rate: number;
  termType: "single_life" | "joint_life" | "shorter_of_years_or_life";
  age1: number;
  age2: number | undefined;
  termYears: number | undefined;
}

function exhaustionProbability(input: ExhaustionInput): number {
  const { inceptionValue, annuity, irc7520Rate: r, age1, age2 } = input;
  if (inceptionValue <= 0 || annuity <= 0) return 0;

  const exhaustionYear = findExhaustionYear(inceptionValue, annuity, r);
  if (exhaustionYear == null) return 0; // never exhausts under §7520 growth

  if (input.termType === "shorter_of_years_or_life") {
    const cap = input.termYears ?? Infinity;
    if (exhaustionYear > cap) return 0; // years cap fires first; not Rev. Rul. relevant
  }

  if (input.termType === "single_life" || input.termType === "shorter_of_years_or_life") {
    if (lx(age1) === 0) return 0;
    return survivalProbability(age1, exhaustionYear);
  }

  // joint_life: last-survivor still alive at t = 1 − (1−tPx)(1−tPy)
  if (age2 == null) return 0;
  const sx = survivalProbability(age1, exhaustionYear);
  const sy = survivalProbability(age2, exhaustionYear);
  return 1 - (1 - sx) * (1 - sy);
}

function findExhaustionYear(
  inceptionValue: number,
  annuity: number,
  r: number,
): number | null {
  const MAX_HORIZON = 120;
  if (annuity <= inceptionValue * r) return null; // never exhausts
  let balance = inceptionValue;
  for (let n = 1; n <= MAX_HORIZON; n++) {
    balance = balance * (1 + r) - annuity;
    if (balance <= 0) return n;
  }
  return null;
}
