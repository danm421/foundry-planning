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

export interface FederalIncomeForState {
  agi: number;
  taxableIncome: number;
  ordinaryIncome: number;
  dividends: number;
  capitalGains: number;
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
      stateFilingStatusUsed: input.filingStatus === "married_joint" ? "joint" : "single",
      bracketsUsed: [{ from: 0, to: null, rate: input.fallbackFlatRate }],
      preCreditTax: stateTax,
      specialRulesApplied: [],
      stateTax,
      diag: { notes: ["No residence state set; using flat fallback rate."] },
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
      stateFilingStatusUsed: input.filingStatus === "married_joint" ? "joint" : "single",
      bracketsUsed: [],
      preCreditTax: 0,
      specialRulesApplied: [],
      stateTax: 0,
      diag: { notes: [`${input.state} does not levy a personal income tax.`] },
    };
  }

  // Easy path: lookup brackets, std deduction, exemption; use FAGI as base.
  // Phase 1 placeholder — Section B will add income-base variations;
  // Section C will subtract SS; Section D will subtract retirement; etc.
  const stateFs = mapFilingStatus(input.filingStatus);
  const brackets = getBrackets(input.state, input.year, stateFs);
  const stdDed = getStdDeduction(input.state, input.year, stateFs, input.primaryAge);
  const exemption = getExemption(input.state, input.year, stateFs);
  const startingIncome = input.federalIncome.agi;
  const stateAGI = startingIncome;
  const personalExemptionDeduction = exemption.type === "exemption" ? exemption.amount : 0;
  const exemptionCredits = exemption.type === "credit" ? exemption.amount : 0;
  const stateTaxableIncome = Math.max(0, stateAGI - stdDed - personalExemptionDeduction);
  const preCreditTax = applyBrackets(stateTaxableIncome, brackets);
  const stateTax = Math.max(0, preCreditTax - exemptionCredits);

  return {
    state: input.state,
    year: input.year,
    hasIncomeTax: true,
    incomeBase: "federal-agi",
    startingIncome,
    addbacks: EMPTY_ADDBACKS,
    subtractions: EMPTY_SUBTRACTIONS,
    stateAGI,
    stdDeduction: stdDed,
    personalExemptionDeduction,
    exemptionCredits,
    stateTaxableIncome,
    filingStatusUsed: input.filingStatus,
    stateFilingStatusUsed: stateFs,
    bracketsUsed: brackets,
    preCreditTax,
    specialRulesApplied: [],
    stateTax,
    diag: { notes: ["Section A easy-path compute (no SS/retirement adjustments yet)."] },
  };
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
