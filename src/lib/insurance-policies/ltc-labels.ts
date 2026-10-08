// src/lib/insurance-policies/ltc-labels.ts
//
// How an LTC policy reads on screen. Shared by the Insurance panel, the policy
// dialog and the scenario change rows, so one policy reads the same everywhere.
// Client-safe.
import type { LtcPolicy } from "@/engine/types";
import { ltcInflationFactor, ltcMonthlyFromUnit } from "@/engine/ltc-benefits";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** decimal 0.035 → "3.5%", without float drift. */
const pctText = (d: number) => `${Math.round(d * 10000) / 100}%`;
const yrs = (n: number) => (n === 1 ? "1 yr" : `${n} yrs`);

export function ltcTypeText(p: LtcPolicy, lifePolicyName: string | null): string {
  if (p.kind === "standalone") return "Traditional";
  return lifePolicyName ? `Rider on ${lifePolicyName}` : "Rider";
}

/** "$6,000/mo · 3 yrs" · "$200/day · lifetime" · "2% of $500,000/mo" · "$5,000/mo". */
export function ltcBenefitText(p: LtcPolicy, faceValue: number | null): string {
  const perUnit = `${usd.format(p.benefitAmount)}/${p.benefitUnit === "day" ? "day" : "mo"}`;
  if (p.kind === "life_rider") {
    if (p.riderBenefitMode !== "pct_of_face") return perUnit;
    const share = p.riderMonthlyPct == null ? "—" : pctText(p.riderMonthlyPct);
    return `${share} of ${faceValue == null ? "the death benefit" : usd.format(faceValue)}/mo`;
  }
  const period =
    p.benefitPeriodMode === "lifetime" ? "lifetime" : p.benefitPeriodYears == null ? "—" : yrs(p.benefitPeriodYears);
  return `${perUnit} · ${period}`;
}

export function ltcInflationText(p: LtcPolicy): string {
  return p.inflationRider === "none" ? "None" : `${pctText(p.inflationRate)} ${p.inflationRider}`;
}

export function ltcPremiumText(p: LtcPolicy): string {
  if (p.kind === "life_rider") return "In the life premium";
  if (p.premiumPayMode === "paid_up" || p.annualPremium <= 0) return "Paid up";
  const when =
    p.premiumPayMode === "lifetime"
      ? "for life"
      : p.premiumPayMode === "to_age"
        ? `to age ${p.premiumPayToAge ?? "—"}`
        : `for ${p.premiumPayYears == null ? "—" : yrs(p.premiumPayYears)}`;
  return `${usd.format(p.annualPremium)}/yr ${when}`;
}

/** The dialog's one-line read-back of what the policy pays in `year`, or null
 *  when there is not enough to say it honestly (no benefit yet; a rider with no
 *  face value to work from). */
export function ltcSummaryText(p: LtcPolicy, faceValue: number | null, year: number): string | null {
  const factor = ltcInflationFactor(p, year);
  if (p.kind === "standalone") {
    if (p.benefitAmount <= 0) return null;
    const monthly = ltcMonthlyFromUnit(p.benefitAmount, p.benefitUnit) * factor;
    const head = `Pays up to ${usd.format(monthly)}/mo in ${year}`;
    if (p.benefitPeriodMode === "lifetime") return `${head}, with no limit on total benefits.`;
    if (p.benefitPeriodYears == null) return `${head}.`;
    return `${head}, from a pool of about ${usd.format(monthly * 12 * p.benefitPeriodYears)}.`;
  }
  if (faceValue == null || faceValue <= 0) return null;
  const base =
    p.riderBenefitMode === "pct_of_face"
      ? (p.riderMonthlyPct ?? 0) * faceValue
      : ltcMonthlyFromUnit(p.benefitAmount, p.benefitUnit);
  const monthly = base * factor;
  if (monthly <= 0) return null;
  const cap = Math.max(0, Math.min(faceValue * (p.riderMaxPct ?? 1), faceValue - p.residualDeathBenefit));
  const months = Math.floor(cap / monthly);
  const extension = p.extensionYears > 0 ? `, then ${p.extensionYears * 12} more months` : "";
  return `Pays up to ${usd.format(monthly)}/mo for about ${months} months${extension}; at least ${usd.format(faceValue - cap)} left to heirs.`;
}
