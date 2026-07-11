import type { CalcInput, TaxResult, TaxYearParameters } from "@/lib/tax/types";
import { calculateTaxYear } from "@/lib/tax/calculate";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { USPSStateCode } from "@/lib/usps-states";

/** Shared "null/undefined → 0" coercion — single copy for adapter.ts,
 *  bracket-map.ts, and the observation modules that need it. */
export const n = (v: number | null | undefined): number => v ?? 0;

export interface AdapterContext {
  taxParams: TaxYearParameters;
  primaryAge: number | null;
  spouseAge: number | null;
}

/** Single source of truth for the Schedule-D presence test: detail is
 *  "present" when either the long- or short-term line was extracted — a
 *  short-term-only return still counts as "present" and must NOT fall back
 *  to line 7. */
export function hasScheduleDDetail(facts: TaxReturnFacts): boolean {
  return facts.income.netLongTermGain != null || facts.income.netShortTermGain != null;
}

/** Single source of truth for the adapter's Schedule-D fallback semantics.
 *  When Schedule D detail is present (see `hasScheduleDDetail`), LTCG is
 *  netLongTermGain (0 when only the short-term line was found). When absent,
 *  LTCG falls back to line 7 (capitalGainOrLoss), which may itself be null.
 *
 *  Exported so callers needing "the LTCG figure for this return" (adapter,
 *  and later observation modules) share exactly one copy of this rule —
 *  the plan's original draft inlined `netLongTermGain ?? capitalGainOrLoss`
 *  in three separate files with subtly diverging trigger conditions. */
export function resolveLtcg(facts: TaxReturnFacts): number | null {
  return hasScheduleDDetail(facts)
    ? (facts.income.netLongTermGain ?? 0)
    : facts.income.capitalGainOrLoss;
}

export function factsToCalcInput(
  facts: TaxReturnFacts,
  ctx: AdapterContext,
): { input: CalcInput; notes: string[] } {
  const notes: string[] = [];
  const inc = facts.income;

  const hasSchedD = hasScheduleDDetail(facts);
  const resolvedLtcg = resolveLtcg(facts);
  const ltcg = Math.max(0, n(resolvedLtcg));
  const stcg = hasSchedD ? Math.max(0, n(inc.netShortTermGain)) : 0;
  if (!hasSchedD && resolvedLtcg != null) {
    notes.push(
      "Long/short-term split unavailable (no Schedule D detail) — net capital gain treated as long-term.",
    );
  }

  // calculateTaxYear derives the QBI deduction internally from qbiIncome
  // (20% below phase-out). Inverting the filed deduction reproduces it exactly
  // for below-threshold filers; above-threshold nuance is absorbed by the
  // reconstruction tolerance.
  const qbiIncome = n(facts.deductions.qbiDeduction) / 0.2;

  const input: CalcInput = {
    year: facts.taxYear,
    filingStatus: facts.filingStatus ?? "single",
    earnedIncome: n(inc.wages) + Math.max(0, n(inc.scheduleCNet)),
    ordinaryIncome:
      n(inc.iraDistributionsTaxable) +
      n(inc.pensionsTaxable) +
      Math.max(0, n(inc.scheduleENet)) +
      n(inc.unemployment) +
      n(inc.otherIncome) +
      Math.max(0, n(inc.ordinaryDividends) - n(inc.qualifiedDividends)),
    interestIncome: n(inc.taxableInterest),
    qualifiedDividends: n(inc.qualifiedDividends),
    longTermCapitalGains: ltcg,
    shortTermCapitalGains: stcg,
    qbiIncome,
    taxExemptIncome: n(inc.taxExemptInterest),
    taxExemptInterest: n(inc.taxExemptInterest),
    socialSecurityGross: n(inc.ssBenefitsGross),
    aboveLineDeductions: n(inc.adjustmentsToIncome),
    itemizedDeductions:
      facts.deductions.deductionTaken === "itemized"
        ? n(facts.deductions.deductionAmount)
        : 0,
    saltDeducted: facts.deductions.scheduleA?.saltDeducted ?? 0,
    flatStateRate: 0,
    taxParams: ctx.taxParams,
    inflationFactor: 1,
    retirementBreakdown: {
      db: n(inc.pensionsTaxable),
      ira: n(inc.iraDistributionsTaxable),
      k401: 0, // 1040 line 4/5 can't distinguish IRA vs 401k custodian type
      annuity: 0,
    },
    // Unknown 2-letter codes fall through computeStateIncomeTax to empty
    // brackets (0 state tax) — safe.
    residenceState: (facts.residenceState as USPSStateCode | null) ?? null,
    primaryAge: ctx.primaryAge ?? undefined,
    spouseAge: ctx.spouseAge ?? undefined,
  };
  return { input, notes };
}

/** Full engine run over the extracted facts. Null when filingStatus is unknown
 *  (bracket selection would be a guess). */
export function runCalc(facts: TaxReturnFacts, ctx: AdapterContext): TaxResult | null {
  if (!facts.filingStatus) return null;
  return calculateTaxYear(factsToCalcInput(facts, ctx).input);
}
