// src/lib/tax/calculate.ts
import type { CalcInput, TaxResult, FilingStatus } from "./types";
import { calcFederalTax, calcMarginalRate, findMarginalTier } from "./federal";
import { calcCapGainsTax } from "./capGains";
import { withStatutoryRates } from "./rate-stress";
import { calcAmtTentative, calcAmtAdditional } from "./amt";
import { calcNiit } from "./niit";
import { calcFica, calcAdditionalMedicare, ficaWagesOf } from "./fica";
import { calcQbiDeduction } from "./qbi";
import { calcTaxableSocialSecurity } from "./ssTaxability";
import { computeStateIncomeTax } from "./state-income";
import { getAdditionalStdDeduction, getObbbaSeniorBonus } from "./senior-deductions";
import { computeCredits } from "./credits";
import {
  netCapitalGainsAndLosses,
  computeCarryforwardOut,
  emptyCapitalLossCarryforward,
} from "./capital-loss";

export function calculateTaxYear(input: CalcInput): TaxResult {
  const p = input.taxParams;
  const fs = input.filingStatus;

  // 1. Categorize income.
  //
  // §1222 netting runs FIRST, before totalIncome/AGI. A net capital loss
  // reduces AGI, and AGI drives §86 SS taxability, NIIT, IRMAA MAGI, QBI
  // thresholds and state GTI — so netting here means none of those call sites
  // need to know losses exist.
  const netting = netCapitalGainsAndLosses({
    longTermGain: input.longTermCapitalGains,
    shortTermGain: input.shortTermCapitalGains,
    carryforwardIn: input.capitalLossCarryforwardIn ?? emptyCapitalLossCarryforward(),
    filingStatus: fs,
  });
  const capitalLossDeduction = netting.capitalLossDeduction;

  const earnedIncome = input.earnedIncome;
  // Used ONLY by the two payroll-tax calls below, so the exempt leg still
  // bracket-taxes, still lands in AGI, and still counts as earned income for
  // the credit layer.
  const ficaWages = ficaWagesOf(earnedIncome, input.ficaExemptEarnedIncome);
  const interestIncome = input.interestIncome ?? 0;
  // Ordinary bucket for bracket tax = non-qual div + RMDs/IRA dists + interest
  // + net STCG (ST gains taxed as ordinary). Interest is tracked separately
  // only so NIIT can pick it up.
  const ordinaryIncome =
    input.ordinaryIncome + interestIncome + netting.netShortTermGain;
  const dividends = input.qualifiedDividends;
  const capitalGains = netting.netLongTermGain;
  const shortCapitalGains = netting.netShortTermGain;

  // 2. SS taxability. Per IRS Pub 915 the "combined income" test uses AGI —
  // i.e. gross taxable income minus above-the-line adjustments — not raw
  // gross. Using gross over-taxes SS for clients making traditional 401(k) /
  // HSA contributions, because those dollars would have come out before AGI.
  const grossOther =
    earnedIncome + ordinaryIncome + dividends + capitalGains + input.qbiIncome
    - capitalLossDeduction;
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
  const nonTaxableIncome =
    input.taxExemptIncome + (input.taxFreeRetirementIncome ?? 0) + nonTaxableSs;

  // The §1211(b) deduction is a negative line inside total income (Form 1040
  // line 7 goes negative), NOT a below-line deduction.
  const totalIncome =
    earnedIncome +
    taxableSocialSecurity +
    ordinaryIncome +
    dividends +
    capitalGains +
    input.qbiIncome -
    capitalLossDeduction;
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

  // §1212(b)(2): the carryover is computed as though only the usable slice of
  // the deduction was consumed. Must be UNFLOORED — clamping to zero here
  // would burn carryforward a zero-income year never actually used.
  // ⚠️ AMTI (step 10) reads this too, for its own reason. Don't re-floor it.
  const taxableIncomeUnfloored =
    adjustedGrossIncome - belowLineDeductions - seniorBonus - qbiDeduction;
  const { carryforwardOut, carryforwardConsumed } = computeCarryforwardOut(
    netting,
    taxableIncomeUnfloored + capitalLossDeduction,
  );

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
  // from the post-QBI figure — Form 6251 line 1 begins at Form 1040 taxable
  // income, which is already net of QBI (there is no QBI add-back line), and
  // where that line is zero it takes AGI minus the deduction lines as a NEGATIVE
  // amount, which is why the figure below is the unfloored one. The
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
  // UNFLOORED (see line 1 above): deductions in excess of income really do
  // reduce AMT income before preference items are added. `taxableIncome` stays
  // floored — regular tax and the bracket base correctly depend on that — and
  // the zero guard inside calcAmtTentative becomes the load-bearing one, which
  // is where it belongs.
  const amti = taxableIncomeUnfloored + amtAddBack + (input.isoSpread ?? 0);
  const amtParams = filingAmtParams(fs, p);
  const tentativeAmt = calcAmtTentative(amti, amtParams, {
    year: input.year,
    ltcgPlusQdiv: capitalGains + dividends,
    // Statutory rates deliberately. The "tax rates rise" stressor writes raised
    // preferential rates onto the params, and AMT is out of its scope by
    // decision — without this strip, AMT would inherit them for free because
    // amt.ts shares calcCapGainsTax with the regular calculation. Stripping
    // here keeps amt.ts itself untouched. See rate-stress.ts.
    capGainsBrackets: withStatutoryRates(p.capGainsBrackets[fs]),
    regularOrdinaryBase: incomeTaxBase,
  });
  const amtAdditional = calcAmtAdditional(tentativeAmt, regularTaxCalc + capitalGainsTax);

  // 11. NIIT
  // Investment income for NIIT: qualified dividends + long-term cap gains +
  // short-term cap gains + taxable interest. Per IRC §1411(c)(1)(A)(i) and
  // (iii), interest and net gains from dispositions of property are both
  // part of net investment income. IRA distributions, RMDs, and SE earnings
  // stay excluded (they're separately excluded by §1411(c)(5)&(6)).
  // Netted figures, not the raw inputs — NIIT must not be charged on gains a
  // loss already erased. Per Reg. §1.1411-4(d) the §1211(b) deduction also
  // reduces net investment income.
  const niitInvestmentClean = Math.max(
    0,
    dividends + capitalGains + shortCapitalGains + interestIncome
      - capitalLossDeduction,
  );
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
    earnedIncome: ficaWages,
    ssTaxRate: p.ssTaxRate,
    ssWageBase: p.ssWageBase,
    medicareTaxRate: p.medicareTaxRate,
  });
  const addlMedicareThreshold = fs === "married_joint" ? p.addlMedicareThreshold.mfj
                              : fs === "married_separate" ? p.addlMedicareThreshold.mfs
                              : p.addlMedicareThreshold.single;
  const additionalMedicare = calcAdditionalMedicare({
    // §3101(b)(2) rides on the same §3121(a) "wages" definition as FICA, so the
    // exempt leg is out of this base too.
    earnedIncome: ficaWages,
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
    contrib529: input.contrib529,
    preTaxContrib: input.aboveLineDeductions,
    fallbackFlatRate: input.flatStateRate,
  });
  const stateTax = stateResult.stateTax;

  // 14. Federal credits (IRC 24 CTC/ACTC + ODC, 25A AOTC, 25B Saver's).
  //
  // `household` is optional and nothing supplies it yet (projection.ts assembly
  // is a later task), so the common path here is "no household → no credits",
  // which leaves the roll-up below identical to its pre-credit form.
  //
  // Chapter 1 subpart A tax — the only base personal credits may offset. Bound
  // to ONE local deliberately: credits.ts clamps its nonrefundable total at
  // whatever base it is handed, so if the figure passed in and the figure
  // credits are subtracted from below ever drifted apart, the clamp would be
  // computed against one base and applied against another and the roll-up's
  // Math.max would silently absorb the inconsistency instead of failing.
  // (Equals `regularFederalIncomeTax + capitalGainsTax + amtAdditional` — see
  // the roll-up, where regularFederalIncomeTax is just regularTaxCalc.)
  const subpartATaxBeforeCredits = regularTaxCalc + capitalGainsTax + amtAdditional;
  const credits = input.household
    ? computeCredits({
        ...input.household,
        // The REQUESTED year, never `p.year`: resolver.ts stamps params with the
        // SOURCE year when it inflates an out-year forward, so reading the year
        // off the params would report the SECURE 2.0 §103 Saver's Credit sunset
        // as never arriving.
        year: input.year,
        filingStatus: fs,
        params: p,
        // MAGI *is* AGI for every household this engine can represent: statutory
        // MAGI (IRC 24(b), 25A(d)) differs only by the §911/§931/§933
        // foreign-earned-income exclusions, and CalcInput has no foreign-exclusion
        // input at all. Exact for domestic filers, not an approximation — the
        // apparent duplication is deliberate, don't collapse it.
        magi: adjustedGrossIncome,
        agi: adjustedGrossIncome,
        // IRC 24(d)(1)(B)(i) -> 32(c)(2)(A): earned income for the refundable
        // CTC is wages PLUS net self-employment earnings. This is the ONLY
        // place the two are combined — `earnedIncome` stays wages-only
        // everywhere else (it feeds calcFica / calcAdditionalMedicare above,
        // and SE income is taxed through SECA in year-tax.ts). Floored at 0 so
        // a Schedule C loss can't shrink wage earned income. Same idiom as
        // tax-analysis/adapter.ts's `wages + max(0, scheduleCNet)`.
        earnedIncome: earnedIncome + Math.max(0, input.household.selfEmploymentEarnings),
        taxBeforeCredits: subpartATaxBeforeCredits,
      })
    : null;
  const nonrefundableCredits = credits?.nonrefundable ?? 0;
  const refundableCredits = credits?.refundable ?? 0;
  // The AOTC actually allowed this year, both halves. Surfaced because
  // projection.ts's IRC 25A(b)(2)(C) four-year counter has to know whether the
  // taxpayer ELECTED the credit, and the only figure that can answer that is
  // the one the credit engine itself produced from its OWN AGI. The report's
  // `magiForCredits` is a different number (it cannot see taxable Social
  // Security or the §164(f) deductible half of SE tax), so a counter driven
  // off it disagrees with what was actually paid — and for a self-employed
  // household it disagrees in the direction that never advances, making the
  // four-year allowance unbounded.
  const aotcAllowed = credits ? credits.byCredit.aotcNonrefundable + credits.byCredit.aotcRefundable : 0;

  // 15. Roll-ups
  // Stays the PRE-credit bracket tax: it is a reported line item meaning
  // "regular bracket tax before credits", and netting credits here as well as
  // in the total below would double-count them.
  const regularFederalIncomeTax = regularTaxCalc; // v1: no AMT credit
  // Nonrefundable personal credits offset chapter 1 subpart A tax ONLY. NIIT
  // (§1411) and Additional Medicare (§3101(b)(2)) sit outside subpart A, so
  // they are added AFTER the floor — folding them inside would let credits wipe
  // out NIIT for any household with children. Refundable credits are subtracted
  // OUTSIDE the floor, so an ACTC/AOTC refund shows up as a negative federal tax
  // rather than being floored away.
  const totalFederalTax =
    Math.max(0, subpartATaxBeforeCredits - nonrefundableCredits) +
    niit +
    additionalMedicare -
    refundableCredits;
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
      taxCredits: nonrefundableCredits,
      refundableCredits,
      aotcAllowed,
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
      // Three income measures the Thresholds report tests but `flow` cannot
      // supply: taxableIncome there is post-QBI and floored, AMTI's add-back
      // depends on which below-line deduction won, and NII is a different
      // subset of income again. Surfaced from the locals that already computed
      // them so no caller has to re-derive (and drift from) them.
      taxableIncomeBeforeQbi,
      amti,
      netInvestmentIncome: niitInvestmentClean,
    },
    state: stateResult,
    capitalLoss: {
      deduction: capitalLossDeduction,
      carryforwardConsumed,
      carryforwardOut,
      shortTermLoss: netting.shortTermLoss,
      longTermLoss: netting.longTermLoss,
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
