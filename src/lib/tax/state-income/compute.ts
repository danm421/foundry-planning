// src/lib/tax/state-income/compute.ts
import type { USPSStateCode } from "@/lib/usps-states";
import type { BracketTier, FilingStatus } from "@/lib/tax/types";
import type { StateIncomeTaxResult, StateFilingStatus } from "./types";
import { isNoIncomeTaxState } from "./data/no-income-tax-states";
import { mapFilingStatus } from "./filing-status";
import { applyBrackets } from "./bracket-calc";
import { BRACKETS_2025 } from "./data/brackets-2025";
import { BRACKETS_2026 } from "./data/brackets-2026";
import { STD_DEDUCTIONS } from "./data/std-deductions";
import { EXEMPTIONS } from "./data/exemptions";
import { INCOME_BASE_RULES } from "./data/income-base";
import { getSsRule } from "./data/ss-rules";
import { computeSsSubtraction } from "./ss-subtraction";
import { getRetirementRule } from "./data/retirement-rules";
import { computeRetirementSubtraction } from "./retirement-subtraction";
import { computeCapGainsAdjustment, computeWaCapGainsTax } from "./cap-gains";
import { CAP_GAINS_RULES } from "./data/cap-gains-rules";
import { applyRecapture } from "./special-rules";

export interface FederalIncomeForState {
  agi: number;
  taxableIncome: number;
  ordinaryIncome: number;
  dividends: number;
  capitalGains: number;
  /** Short-term portion of `capitalGains`. LTCG = capitalGains − shortCapitalGains. */
  shortCapitalGains: number;
  earnedIncome: number;
  taxableSocialSecurity: number;
  taxExemptIncome: number;
}

export interface RetirementBreakdown {
  db: number;
  ira: number;
  k401: number;
  annuity: number;
}

export interface ComputeStateIncomeTaxInput {
  state: USPSStateCode | null;
  year: number;
  filingStatus: FilingStatus;
  primaryAge: number;
  spouseAge?: number;
  federalIncome: FederalIncomeForState;
  retirementBreakdown: RetirementBreakdown;
  preTaxContrib: number;
  fallbackFlatRate: number;
}

const EMPTY_SUBTRACTIONS = {
  socialSecurity: 0, retirementIncome: 0, capitalGains: 0,
  preTaxContrib: 0, other: 0, total: 0,
};
const EMPTY_ADDBACKS = { taxFreeInterest: 0, other: 0, total: 0 };

export function computeStateIncomeTax(
  input: ComputeStateIncomeTaxInput,
): StateIncomeTaxResult {
  // Null state → flat-rate fallback (preserves legacy behavior)
  if (input.state == null) {
    const stateTax = Math.max(0, input.federalIncome.taxableIncome) * input.fallbackFlatRate;
    return {
      state: null,
      year: input.year,
      hasIncomeTax: input.fallbackFlatRate > 0,
      incomeBase: "federal-taxable",
      startingIncome: input.federalIncome.taxableIncome,
      addbacks: EMPTY_ADDBACKS,
      subtractions: EMPTY_SUBTRACTIONS,
      stateAGI: input.federalIncome.taxableIncome,
      stdDeduction: 0,
      personalExemptionDeduction: 0,
      exemptionCredits: 0,
      stateTaxableIncome: input.federalIncome.taxableIncome,
      filingStatusUsed: input.filingStatus,
      stateFilingStatusUsed: mapFilingStatus(input.filingStatus),
      bracketsUsed: [{ from: 0, to: null, rate: input.fallbackFlatRate }],
      preCreditTax: stateTax,
      specialRulesApplied: [],
      stateTax,
      diag: { notes: ["No residence state set; using flat fallback rate."] },
    };
  }

  // WA: gains-only tax. Short-circuit so we never apply ordinary-income brackets
  // or wage-based subtractions — WA taxes long-term capital gains only.
  if (input.state === "WA") {
    const ltcg = Math.max(0, input.federalIncome.capitalGains - input.federalIncome.shortCapitalGains);
    const waStateFs = mapFilingStatus(input.filingStatus);
    const waAge = Math.max(input.primaryAge, input.spouseAge ?? 0);
    const exclusion = getStdDeduction("WA", input.year, waStateFs, waAge);
    const taxableLtcg = Math.max(0, ltcg - exclusion);
    const tax = computeWaCapGainsTax(taxableLtcg);
    return {
      state: "WA",
      year: input.year,
      hasIncomeTax: true,
      incomeBase: "federal-agi",
      startingIncome: ltcg,
      addbacks: EMPTY_ADDBACKS,
      subtractions: { ...EMPTY_SUBTRACTIONS },
      stateAGI: ltcg,
      stdDeduction: exclusion,
      personalExemptionDeduction: 0,
      exemptionCredits: 0,
      stateTaxableIncome: taxableLtcg,
      filingStatusUsed: input.filingStatus,
      stateFilingStatusUsed: waStateFs,
      bracketsUsed: CAP_GAINS_RULES.WA!.gainsOnly!.brackets,
      preCreditTax: tax,
      specialRulesApplied: ["WA-gains-only"],
      stateTax: tax,
      diag: {
        notes: [
          `WA standard exclusion: $${exclusion.toLocaleString()} applied to LTCG before brackets.`,
          "WA gains-only tax: 7% first $1M, 9% above.",
        ],
      },
    };
  }

  // No-income-tax state → zero
  if (isNoIncomeTaxState(input.state)) {
    return {
      state: input.state,
      year: input.year,
      hasIncomeTax: false,
      incomeBase: "federal-agi",
      startingIncome: 0,
      addbacks: EMPTY_ADDBACKS,
      subtractions: EMPTY_SUBTRACTIONS,
      stateAGI: 0,
      stdDeduction: 0,
      personalExemptionDeduction: 0,
      exemptionCredits: 0,
      stateTaxableIncome: 0,
      filingStatusUsed: input.filingStatus,
      stateFilingStatusUsed: mapFilingStatus(input.filingStatus),
      bracketsUsed: [],
      preCreditTax: 0,
      specialRulesApplied: [],
      stateTax: 0,
      diag: { notes: [`${input.state} does not levy a personal income tax.`] },
    };
  }

  // Determine income base for this state.
  const baseRule = INCOME_BASE_RULES[input.state] ?? {
    base: "federal-agi" as const,
    taxFreeInterestAddback: false,
    preTaxRetirementSubtract: false,
    alimonySubtract: false,
  };

  const startingIncome =
    baseRule.base === "federal-taxable"
      ? input.federalIncome.taxableIncome
      : baseRule.base === "state-gti"
        ? buildStateGti(input)
        : input.federalIncome.agi;

  const taxFreeInterestAddback = baseRule.taxFreeInterestAddback
    ? input.federalIncome.taxExemptIncome
    : 0;
  const addbacks = {
    taxFreeInterest: taxFreeInterestAddback,
    other: 0,
    total: taxFreeInterestAddback,
  };

  // Section C: SS subtraction
  const ssRule = getSsRule(input.state, input.year);
  const ssResult = computeSsSubtraction({
    rule: ssRule,
    taxableSocialSecurity: input.federalIncome.taxableSocialSecurity,
    agi: input.federalIncome.agi,
    age: Math.max(input.primaryAge, input.spouseAge ?? 0),
    isJoint: input.filingStatus === "married_joint",
  });

  // Section D: retirement-income subtraction
  const retirementRule = getRetirementRule(input.state, input.year);
  const retirementResult = computeRetirementSubtraction({
    rule: retirementRule,
    breakdown: input.retirementBreakdown,
    isJoint: input.filingStatus === "married_joint",
    age: Math.max(input.primaryAge, input.spouseAge ?? 0),
    agi: input.federalIncome.agi,
    filers: input.filingStatus === "married_joint" ? 2 : 1,
  });
  // Combined SS + retirement cap (CO): if rule says so, recap combined sum.
  let retirementAmount = retirementResult.amount;
  if (retirementRule.combinedSsCap && retirementRule.perFilerCap != null) {
    const filers = input.filingStatus === "married_joint" ? 2 : 1;
    const combinedCap = retirementRule.perFilerCap * filers;
    const combined = ssResult.amount + retirementAmount;
    if (combined > combinedCap) retirementAmount = Math.max(0, combinedCap - ssResult.amount);
  }

  // Section E: LTCG carve-out (AR/MT/ND/WI). WA handled above in short-circuit.
  const capGainsAdj = computeCapGainsAdjustment(input.state, {
    ltcg: input.federalIncome.capitalGains - input.federalIncome.shortCapitalGains,
    stcg: input.federalIncome.shortCapitalGains,
  });

  const subtractions = {
    socialSecurity: ssResult.amount,
    retirementIncome: retirementAmount,
    capitalGains: capGainsAdj,
    preTaxContrib: 0,       // Section E remaining: preTaxContrib
    other: 0,
    total: ssResult.amount + retirementAmount + capGainsAdj,
  };

  // Easy path: lookup brackets, std deduction, exemption.
  // Section D will subtract retirement; Section E cap gains / pre-tax contrib; etc.
  const stateFs = mapFilingStatus(input.filingStatus);
  const brackets = getBrackets(input.state, input.year, stateFs);
  const stdDed = getStdDeduction(input.state, input.year, stateFs, input.primaryAge);
  const exemption = getExemption(input.state, input.year, stateFs);
  const stateAGI = startingIncome + addbacks.total - subtractions.total;
  const personalExemptionDeduction = exemption.type === "exemption" ? exemption.amount : 0;
  const exemptionCredits = exemption.type === "credit" ? exemption.amount : 0;
  const stateTaxableIncome = Math.max(0, stateAGI - stdDed - personalExemptionDeduction);
  const preCreditTax = applyBrackets(stateTaxableIncome, brackets);
  const recapture = applyRecapture(input.state, {
    stateTaxableIncome,
    preCreditTax,
    filingStatus: stateFs,
  });
  const adjustedPreCreditTax = preCreditTax + recapture.adjustment;
  const stateTax = Math.max(0, adjustedPreCreditTax - exemptionCredits);
  const specialRulesApplied: string[] = [];
  if (recapture.adjustment > 0) specialRulesApplied.push(`${input.state}-recapture`);
  if (capGainsAdj > 0) specialRulesApplied.push(`${input.state}-LTCG-carveout`);

  const notes = [ssResult.note, retirementResult.note];
  if (recapture.adjustment > 0) notes.push(recapture.note);

  return {
    state: input.state,
    year: input.year,
    hasIncomeTax: true,
    incomeBase: baseRule.base,
    startingIncome,
    addbacks,
    subtractions,
    stateAGI,
    stdDeduction: stdDed,
    personalExemptionDeduction,
    exemptionCredits,
    stateTaxableIncome,
    filingStatusUsed: input.filingStatus,
    stateFilingStatusUsed: stateFs,
    bracketsUsed: brackets,
    preCreditTax: adjustedPreCreditTax,
    specialRulesApplied,
    stateTax,
    diag: { notes },
  };
}

function buildStateGti(input: ComputeStateIncomeTaxInput): number {
  const f = input.federalIncome;
  // State-defined GTI: earned income + non-wage ordinary income + dividends + capital gains + taxable SS.
  // Note: ordinaryIncome in the engine contract is non-wage (RMDs, IRA distributions, non-qual divs, etc.)
  // and does NOT include earnedIncome — so these two buckets are additive, not overlapping.
  return f.earnedIncome + f.ordinaryIncome + f.dividends + f.capitalGains + f.taxableSocialSecurity;
}

function getBrackets(
  state: USPSStateCode,
  year: number,
  fs: StateFilingStatus,
): BracketTier[] {
  const set = year >= 2026 ? BRACKETS_2026 : BRACKETS_2025;
  const byState = set[state];
  if (!byState) return [];
  return byState[fs] ?? [];
}

function getStdDeduction(
  state: USPSStateCode,
  year: number,
  fs: StateFilingStatus,
  age: number,
): number {
  const yearSet = STD_DEDUCTIONS[year] ?? STD_DEDUCTIONS[2026];
  const row = yearSet[state];
  if (!row) return 0;
  const base = fs === "joint" ? row.joint : row.single;
  const age65 = age >= 65 ? (fs === "joint" ? row.add65Joint : row.add65Single) : 0;
  return base + age65;
}

function getExemption(
  state: USPSStateCode,
  year: number,
  fs: StateFilingStatus,
): { type: "exemption" | "credit" | "none"; amount: number } {
  const yearSet = EXEMPTIONS[year] ?? EXEMPTIONS[2026];
  const row = yearSet[state];
  if (!row) return { type: "none", amount: 0 };
  if (row.type === "none") return { type: "none", amount: 0 };
  // For credit-type states, both single & joint columns express the per-filer-count credit;
  // workbook stores joint-column as 2× single, so we just use the appropriate column.
  const amount = fs === "joint" ? row.joint : row.single;
  return { type: row.type, amount };
}
