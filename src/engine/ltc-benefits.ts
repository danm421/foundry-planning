// src/engine/ltc-benefits.ts
//
// Long-term care policy math. Pure and framework-free.
//
// One copy of each formula: the Insurance page's read-back line
// (`ltc-labels.ts`), the premium synthesizer and the payout walk below all
// call these, so the screen and the projection cannot drift.
import type { LtcPolicy } from "./types";

/** The inflation rider's growth factor for `year`, measured from the ISSUE
 *  year (not the claim year). 1 in or before the issue year. */
export function ltcInflationFactor(
  p: Pick<LtcPolicy, "inflationRider" | "inflationRate" | "issueYear">,
  year: number,
): number {
  const n = Math.max(0, year - p.issueYear);
  if (p.inflationRider === "simple") return 1 + p.inflationRate * n;
  if (p.inflationRider === "compound") return (1 + p.inflationRate) ** n;
  return 1;
}

/** A benefit as a monthly figure: a daily benefit pays day × 365 / 12. */
export function ltcMonthlyFromUnit(amount: number, unit: LtcPolicy["benefitUnit"]): number {
  return unit === "day" ? (amount * 365) / 12 : amount;
}

/** The id prefix of the premium expense row a traditional policy bills
 *  (`withSynthesizedLtcPremiums`). The LTC pre-pass finds the row by it to
 *  waive or drop it. */
export const LTC_PREMIUM_ID_PREFIX = "ltc-premium-";
export const ltcPremiumExpenseId = (policyId: string): string => `${LTC_PREMIUM_ID_PREFIX}${policyId}`;

/** The id of the tax-free income row a policy's benefits are paid through. */
export const ltcBenefitIncomeId = (policyId: string): string => `ltc-benefit-${policyId}`;

type StandaloneMath = Pick<
  LtcPolicy,
  "benefitAmount" | "benefitUnit" | "inflationRider" | "inflationRate" | "issueYear"
>;

/** A traditional policy's monthly benefit in `year`: day → month, grown by its
 *  inflation rider from the issue year. Before the home-care share. */
export function ltcStandaloneMonthly(p: StandaloneMath, year: number): number {
  return ltcMonthlyFromUnit(p.benefitAmount, p.benefitUnit) * ltcInflationFactor(p, year);
}

/** A traditional policy's whole pool in `year` dollars, before any claim:
 *  monthly × 12 × benefit years. Null for a lifetime policy (no limit) or one
 *  with no benefit period entered. */
export function ltcStandalonePool(
  p: StandaloneMath & Pick<LtcPolicy, "benefitPeriodMode" | "benefitPeriodYears">,
  year: number,
): number | null {
  if (p.benefitPeriodMode !== "years" || p.benefitPeriodYears == null) return null;
  return ltcStandaloneMonthly(p, year) * 12 * p.benefitPeriodYears;
}

/** A rider's monthly limit in `year` on a life policy whose death benefit is
 *  `face`: a share of the face, or a fixed amount, grown by the rider's
 *  inflation option. Before the home-care share. */
export function ltcRiderMonthly(
  p: StandaloneMath & Pick<LtcPolicy, "riderBenefitMode" | "riderMonthlyPct">,
  face: number,
  year: number,
): number {
  const base =
    p.riderBenefitMode === "pct_of_face"
      ? (p.riderMonthlyPct ?? 0) * face
      : ltcMonthlyFromUnit(p.benefitAmount, p.benefitUnit);
  return base * ltcInflationFactor(p, year);
}

/** The most a rider can draw from a death benefit of `face`: the lower of
 *  face × its maximum share and face − its guaranteed minimum. FIXED in
 *  death-benefit dollars: it does not grow with the inflation option (Dan,
 *  2026-10-08), so a larger monthly limit uses it up sooner. */
export function ltcRiderCap(p: Pick<LtcPolicy, "riderMaxPct" | "residualDeathBenefit">, face: number): number {
  return Math.max(0, Math.min(face * (p.riderMaxPct ?? 1), face - p.residualDeathBenefit));
}
