import type { LifeInsuranceCashValueScheduleRow, LifeInsurancePolicy } from "./types";

type ScheduleColumn = "cashValue" | "premiumAmount" | "income" | "deathBenefit";

/**
 * Resolve a single schedule column for a year.
 *
 * - Only rows where `column` is defined participate.
 * - Exact year → row value.
 * - Between two rows → linear interpolation.
 * - Before first / after last → flat-extend.
 * - No row defines the column → null.
 */
export function resolveScheduledColumnForYear(
  schedule: LifeInsuranceCashValueScheduleRow[],
  year: number,
  column: ScheduleColumn,
): number | null {
  const points = schedule
    .filter((r) => r[column] != null)
    .map((r) => ({ year: r.year, value: r[column] as number }))
    .sort((a, b) => a.year - b.year);

  if (points.length === 0) return null;
  if (year <= points[0].year) return points[0].value;
  if (year >= points[points.length - 1].year) {
    return points[points.length - 1].value;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (year >= lo.year && year <= hi.year) {
      if (year === lo.year) return lo.value;
      if (year === hi.year) return hi.value;
      const t = (year - lo.year) / (hi.year - lo.year);
      return lo.value + t * (hi.value - lo.value);
    }
  }
  return null;
}

/**
 * Back-compat cash-value resolver. Throws on empty schedule (existing
 * contract relied on by the projection's free-form override block).
 */
export function resolveCashValueForYear(
  schedule: LifeInsuranceCashValueScheduleRow[],
  year: number,
): number {
  const v = resolveScheduledColumnForYear(schedule, year, "cashValue");
  if (v == null) {
    throw new Error("resolveCashValueForYear: empty cash-value schedule");
  }
  return v;
}

/** The death benefit the contract states for `year`: the schedule's figure
 *  when the policy uses a death-benefit schedule, else the face value. Before
 *  any LTC rider draw. */
export function contractDeathBenefitForYear(policy: LifeInsurancePolicy, year: number): number {
  const scheduled =
    policy.deathBenefitScheduleMode === "scheduled"
      ? resolveScheduledColumnForYear(policy.cashValueSchedule, year, "deathBenefit")
      : null;
  return scheduled ?? policy.faceValue;
}

/** Dollars LTC riders have drawn from this policy through the end of `year`. */
export function ltcAcceleratedThrough(policy: LifeInsurancePolicy, year: number): number {
  let total = 0;
  for (const [y, amount] of Object.entries(policy.ltcAcceleration?.byYear ?? {})) {
    if (Number(y) <= year) total += amount;
  }
  return total;
}

/** The death benefit paid if the insured dies in `year`: the contract figure
 *  less every rider draw so far, never below the rider's guaranteed minimum,
 *  and never above the contract figure. The one place the engine computes it
 *  (payout, §2035). */
export function deathBenefitForYear(policy: LifeInsurancePolicy, year: number): number {
  const contract = contractDeathBenefitForYear(policy, year);
  const drawn = ltcAcceleratedThrough(policy, year);
  if (drawn <= 0) return contract;
  return Math.max(contract - drawn, Math.min(contract, policy.ltcAcceleration!.minimumDeathBenefit));
}

/** The share of the cash value left after rider draws: 1 − drawn ÷ the
 *  contract death benefit, within [0, 1]. 1 with no draws. */
export function ltcCashValueShare(policy: LifeInsurancePolicy, year: number): number {
  const drawn = ltcAcceleratedThrough(policy, year);
  if (drawn <= 0) return 1;
  const contract = contractDeathBenefitForYear(policy, year);
  return contract > 0 ? Math.min(1, Math.max(0, 1 - drawn / contract)) : 0;
}
