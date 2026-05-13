// src/lib/tax/state-income/compute.ts
import type { USPSStateCode } from "@/lib/usps-states";
import type { FilingStatus } from "@/lib/tax/types";
import type { StateIncomeTaxResult } from "./types";
import { isNoIncomeTaxState } from "./data/no-income-tax-states";

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

  throw new Error(
    `computeStateIncomeTax: rules for ${input.state} not yet implemented`,
  );
}
