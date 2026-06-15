// src/lib/tax/calculate.ts
import type { CalcInput, TaxResult, FilingStatus } from "./types";
import { calcFederalTax, calcMarginalRate, findMarginalTier } from "./federal";
import { calcCapGainsTax } from "./capGains";
import { calcAmtTentative, calcAmtAdditional } from "./amt";
import { calcNiit } from "./niit";
import { calcFica, calcAdditionalMedicare } from "./fica";
import { calcQbiDeduction } from "./qbi";
import { calcTaxableSocialSecurity } from "./ssTaxability";
import { computeStateIncomeTax } from "./state-income";
import { getAdditionalStdDeduction, getObbbaSeniorBonus } from "./senior-deductions";

export function calculateTaxYear(input: CalcInput): TaxResult {
  const p = input.taxParams;
  const fs = input.filingStatus;

  // 1. Categorize income
  const earnedIncome = input.earnedIncome;
  const interestIncome = input.interestIncome ?? 0;
  // Ordinary bucket for bracket tax = non-qual div + RMDs/IRA dists + interest
  // + STCG (ST gains taxed as ordinary). Interest is tracked separately only
  // so NIIT can pick it up.
  const ordinaryIncome = input.ordinaryIncome + interestIncome + input.shortTermCapitalGains;
  const dividends = input.qualifiedDividends;
  const capitalGains = input.longTermCapitalGains;
  const shortCapitalGains = input.shortTermCapitalGains;

  // 2. SS taxability. Per IRS Pub 915 the "combined income" test uses AGI —
  // i.e. gross taxable income minus above-the-line adjustments — not raw
  // gross. Using gross over-taxes SS for clients making traditional 401(k) /
  // HSA contributions, because those dollars would have come out before AGI.
  const grossOther =
    earnedIncome + ordinaryIncome + dividends + capitalGains + input.qbiIncome;
  const otherIncomeForSs = Math.max(0, grossOther - input.aboveLineDeductions);
  const taxableSocialSecurity = calcTaxableSocialSecurity({
    ssGross: input.socialSecurityGross,
    otherIncome: otherIncomeForSs,
    // §86 combined income counts tax-exempt INTEREST only (Form 1040 line 2a),
    // not the broad non-taxable bucket. Fall back to taxExemptIncome for callers
    // that haven't migrated to the narrow field.
    taxExemptInterest: input.taxExemptInterest ?? input.taxExemptIncome,
    filingStatus: fs,
  });
  const nonTaxableSs = input.socialSecurityGross - taxableSocialSecurity;
  const nonTaxableIncome = input.taxExemptIncome + nonTaxableSs;

  const totalIncome =
    earnedIncome +
    taxableSocialSecurity +
    ordinaryIncome +
    dividends +
    capitalGains +
    input.qbiIncome;
  const grossTotalIncome = totalIncome + nonTaxableIncome;

  // 3. AGI
  const adjustedGrossIncome = totalIncome - input.aboveLineDeductions;

  // 4. Below-line deductions (standard or itemized, whichever larger). The §63(f)
  //    additional standard deduction (65+/blind boxes) augments the STANDARD path
  //    only — never itemized — per IRC §63(f); 2026 amounts from Rev. Proc. 2025-32.
  const baseStdDeduction = p.stdDeduction[fs];
  const additionalStdDeduction = getAdditionalStdDeduction(
    input.year, fs, input.primaryAge ?? 0, input.spouseAge, input.inflationFactor,
  );
  const stdDeduction = baseStdDeduction + additionalStdDeduction;
  const usedStandard = stdDeduction >= input.itemizedDeductions; // std wins ties (Math.max)
  const belowLineDeductions = Math.max(stdDeduction, input.itemizedDeductions);

  // OBBBA temporary senior bonus (P.L. 119-21 §70103) — reduces taxable income for
  // std OR itemized filers; allowed for AMT (no §56 add-back). TY2025-2028.
  // MAGI = AGI (statutory MAGI adds back §911/931/933 foreign exclusions only,
  // which this engine does not model — tax-exempt muni interest is NOT included).
  const seniorBonus = getObbbaSeniorBonus(
    input.year, fs, input.primaryAge ?? 0, input.spouseAge, adjustedGrossIncome,
  );

  // Taxable income before QBI (needed for QBI cap and threshold check)
  const taxableIncomeBeforeQbi = Math.max(
    0, adjustedGrossIncome - belowLineDeductions - seniorBonus,
  );

  // 5. QBI deduction
  const qbiThreshold = fs === "married_joint" ? p.qbi.thresholdMfj : p.qbi.thresholdSingleHohMfs;
  const qbiPhaseInRange = fs === "married_joint" ? p.qbi.phaseInRangeMfj : p.qbi.phaseInRangeOther;
  const qbiDeduction = calcQbiDeduction({
    qbi: input.qbiIncome,
    taxableIncomeBeforeQbi,
    ltCapGainsAndQualDiv: capitalGains + dividends,
    threshold: qbiThreshold,
    phaseInRange: qbiPhaseInRange,
  });

  // 6. Final taxable income
  const taxableIncome = Math.max(0, taxableIncomeBeforeQbi - qbiDeduction);

  // 7. Income tax base = taxable income minus LTCG and qual div (taxed separately)
  const incomeTaxBase = Math.max(0, taxableIncome - capitalGains - dividends);

  // 8. Regular bracket tax (rounded to nearest dollar, per IRS practice)
  const brackets = p.incomeBrackets[fs];
  const regularTaxCalc = Math.round(calcFederalTax(incomeTaxBase, brackets));

  // 9. Cap gains tax. Per the Qualified Dividends & Capital Gain Tax Worksheet
  // (IRC §1(h)), the preferentially-taxed amount is the SMALLER of (net cap gain
  // + qual div) and taxable income: below-line deductions/QBI that exceed
  // ordinary income spill onto the gain and shrink the amount taxed at 0/15/20%.
  // With incomeTaxBase floored at 0, this clamp keeps incomeTaxBase +
  // preferentialBase == taxableIncome in all cases.
  const preferentialBase = Math.min(capitalGains + dividends, taxableIncome);
  const capitalGainsTax = calcCapGainsTax(
    preferentialBase,
    incomeTaxBase,
    p.capGainsBrackets[fs]
  );

  // 10. AMT
  // Simplified AMTI: post-QBI taxable income + ISO bargain element (the one AMT
  // preference item wired in v1). Other preference items are still omitted.
  // The §199A QBI deduction IS allowed for AMT (IRC §199A(f)(2)), so we start
  // from post-QBI taxableIncome — Form 6251 line 1 begins at Form 1040 taxable
  // income, which is already net of QBI (there is no QBI add-back line). The
  // standard deduction — including the §63(f) aged/blind add-on — is NOT allowed
  // for AMT (IRC §56(b)(1)(E) / Form 6251 line 2a), so when it was the deduction
  // taken the FULL standard deduction must be added back. For ITEMIZERS the
  // disallowed item is instead the Schedule A line 7 SALT deduction (state/local
  // income + property, post-§164 cap) — IRC §56(b)(1)(A)(ii) / Form 6251 line 2a
  // (F7). The OBBBA senior bonus is NOT a §56 preference item → no add-back (it
  // stays out of taxableIncome and out of AMTI alike).
  // Form 6251 Part III: LTCG + qualified dividends inside AMTI are taxed at
  // 0/15/20% (the same preferential rates as regular), not 26/28%. Passing them
  // through — with the regular ordinary base as the stacking floor — so
  // calcAmtTentative can split the base.
  const amtAddBack = usedStandard
    ? stdDeduction                 // F12: full standard incl. §63(f)
    : (input.saltDeducted ?? 0);   // F7: Schedule A line 7 taxes (post-§164 cap)
  const amti = taxableIncome + amtAddBack + (input.isoSpread ?? 0);
  const amtParams = filingAmtParams(fs, p);
  const tentativeAmt = calcAmtTentative(amti, amtParams, {
    year: input.year,
    ltcgPlusQdiv: capitalGains + dividends,
    capGainsBrackets: p.capGainsBrackets[fs],
    regularOrdinaryBase: incomeTaxBase,
  });
  const amtAdditional = calcAmtAdditional(tentativeAmt, regularTaxCalc + capitalGainsTax);

  // 11. NIIT
  // Investment income for NIIT: qualified dividends + long-term cap gains +
  // short-term cap gains + taxable interest. Per IRC §1411(c)(1)(A)(i) and
  // (iii), interest and net gains from dispositions of property are both
  // part of net investment income. IRA distributions, RMDs, and SE earnings
  // stay excluded (they're separately excluded by §1411(c)(5)&(6)).
  const niitInvestmentClean =
    input.qualifiedDividends +
    input.longTermCapitalGains +
    input.shortTermCapitalGains +
    interestIncome;
  const niitThreshold = fs === "married_joint" ? p.niitThreshold.mfj
                       : fs === "married_separate" ? p.niitThreshold.mfs
                       : p.niitThreshold.single;
  const niit = calcNiit({
    magi: adjustedGrossIncome,
    investmentIncome: niitInvestmentClean,
    threshold: niitThreshold,
    rate: p.niitRate,
  });

  // 12. FICA + Additional Medicare
  const ficaResult = calcFica({
    earnedIncome,
    ssTaxRate: p.ssTaxRate,
    ssWageBase: p.ssWageBase,
    medicareTaxRate: p.medicareTaxRate,
  });
  const addlMedicareThreshold = fs === "married_joint" ? p.addlMedicareThreshold.mfj
                              : fs === "married_separate" ? p.addlMedicareThreshold.mfs
                              : p.addlMedicareThreshold.single;
  const additionalMedicare = calcAdditionalMedicare({
    earnedIncome,
    threshold: addlMedicareThreshold,
    rate: p.addlMedicareRate,
  });

  // 13. State tax — bracket engine if residenceState set, otherwise flat fallback.
  //
  // Compute contract: `ordinaryIncome` is the non-wage ordinary bucket
  // (RMDs/IRA dists/non-qual divs/interest); `earnedIncome` is wages;
  // `capitalGains` is total gains (LTCG + STCG). The local `ordinaryIncome`
  // here has already had STCG folded in for federal bracketing — we strip
  // that back out by passing `input.ordinaryIncome + interestIncome` so the
  // state engine's GTI math doesn't double-count STCG inside both the OI
  // bucket and the capital-gains bucket.
  const stateResult = computeStateIncomeTax({
    state: input.residenceState ?? null,
    year: input.year,
    filingStatus: input.filingStatus,
    primaryAge: input.primaryAge ?? 0,
    spouseAge: input.spouseAge,
    federalIncome: {
      agi: adjustedGrossIncome,
      taxableIncome,
      ordinaryIncome: input.ordinaryIncome + interestIncome,
      dividends,
      capitalGains: capitalGains + shortCapitalGains,
      shortCapitalGains,
      earnedIncome,
      taxableSocialSecurity,
      taxExemptIncome: input.taxExemptIncome ?? 0,
    },
    retirementBreakdown: input.retirementBreakdown ?? { db: 0, ira: 0, k401: 0, annuity: 0 },
    preTaxContrib: input.aboveLineDeductions,
    fallbackFlatRate: input.flatStateRate,
  });
  const stateTax = stateResult.stateTax;

  // 14. Roll-ups
  const regularFederalIncomeTax = regularTaxCalc; // v1: no AMT credit, no tax credits
  const totalFederalTax =
    regularFederalIncomeTax +
    capitalGainsTax +
    amtAdditional +
    niit +
    additionalMedicare;
  const totalTax = totalFederalTax + stateTax + ficaResult.total;

  return {
    income: {
      earnedIncome,
      taxableSocialSecurity,
      ordinaryIncome,
      dividends,
      capitalGains,
      shortCapitalGains,
      qbi: input.qbiIncome,
      totalIncome,
      nonTaxableIncome,
      grossTotalIncome,
    },
    flow: {
      aboveLineDeductions: input.aboveLineDeductions,
      adjustedGrossIncome,
      qbiDeduction,
      belowLineDeductions,
      taxableIncome,
      incomeTaxBase,
      regularTaxCalc,
      amtCredit: 0,
      taxCredits: 0,
      regularFederalIncomeTax,
      capitalGainsTax,
      amtAdditional,
      niit,
      additionalMedicare,
      fica: ficaResult.total,
      stateTax,
      totalFederalTax,
      totalTax,
      earlyWithdrawalPenalty: 0,
    },
    diag: {
      marginalFederalRate: calcMarginalRate(incomeTaxBase, brackets),
      marginalBracketTier: findMarginalTier(incomeTaxBase, brackets) ?? brackets[0],
      incomeBracketsForFiling: brackets,
      effectiveFederalRate: grossTotalIncome > 0 ? totalFederalTax / grossTotalIncome : 0,
      bracketsUsed: p,
      inflationFactor: input.inflationFactor,
    },
    state: stateResult,
  };
}

function filingAmtParams(fs: FilingStatus, p: CalcInput["taxParams"]) {
  if (fs === "married_joint") {
    return {
      amtExemption: p.amtExemption.mfj,
      amtBreakpoint2628: p.amtBreakpoint2628.mfjShoh,
      amtPhaseoutStart: p.amtPhaseoutStart.mfj,
    };
  }
  if (fs === "married_separate") {
    return {
      amtExemption: p.amtExemption.mfs,
      amtBreakpoint2628: p.amtBreakpoint2628.mfs,
      amtPhaseoutStart: p.amtPhaseoutStart.mfs,
    };
  }
  return {
    amtExemption: p.amtExemption.singleHoh,
    amtBreakpoint2628: p.amtBreakpoint2628.mfjShoh,
    amtPhaseoutStart: p.amtPhaseoutStart.singleHoh,
  };
}
