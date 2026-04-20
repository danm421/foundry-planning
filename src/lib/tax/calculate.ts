// src/lib/tax/calculate.ts
import type { CalcInput, TaxResult, FilingStatus } from "./types";
import { calcFederalTax, calcMarginalRate } from "./federal";
import { calcCapGainsTax } from "./capGains";
import { calcAmtTentative, calcAmtAdditional } from "./amt";
import { calcNiit } from "./niit";
import { calcFica, calcAdditionalMedicare } from "./fica";
import { calcQbiDeduction } from "./qbi";
import { calcTaxableSocialSecurity } from "./ssTaxability";
import { calcStateTax } from "./state";

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
    taxExemptInterest: input.taxExemptIncome,
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

  // 4. Below-line deductions (standard or itemized, whichever larger)
  const stdDeduction = p.stdDeduction[fs];
  const belowLineDeductions = Math.max(stdDeduction, input.itemizedDeductions);

  // Taxable income before QBI (needed for QBI cap and threshold check)
  const taxableIncomeBeforeQbi = Math.max(0, adjustedGrossIncome - belowLineDeductions);

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

  // 9. Cap gains tax
  const capitalGainsTax = calcCapGainsTax(
    capitalGains + dividends,
    incomeTaxBase,
    p.capGainsBrackets[fs]
  );

  // 10. AMT
  // Simplified AMTI: taxable income before QBI + nothing else added back in v1.
  // Real AMTI requires preference items. v1 uses taxable income before QBI as proxy.
  // Form 6251 Part III: LTCG + qualified dividends inside AMTI are taxed at
  // 0/15/20% (the same preferential rates as regular), not 26/28%. Passing
  // them through so calcAmtTentative can split the base.
  const amti = taxableIncomeBeforeQbi;
  const amtParams = filingAmtParams(fs, p);
  const tentativeAmt = calcAmtTentative(amti, amtParams, {
    year: input.year,
    ltcgPlusQdiv: capitalGains + dividends,
    capGainsBrackets: p.capGainsBrackets[fs],
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

  // 13. State tax (flat × taxable income, matches existing behavior)
  const stateTax = calcStateTax(taxableIncome, input.flatStateRate);

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
    },
    diag: {
      marginalFederalRate: calcMarginalRate(incomeTaxBase, brackets),
      effectiveFederalRate: grossTotalIncome > 0 ? totalFederalTax / grossTotalIncome : 0,
      bracketsUsed: p,
      inflationFactor: input.inflationFactor,
    },
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
