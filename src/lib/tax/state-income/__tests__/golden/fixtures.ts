// src/lib/tax/state-income/__tests__/golden/fixtures.ts
// Profile builders for the all-51-jurisdictions golden suite.
//
// Two synthetic profiles:
//   1. Retiree, married-joint, both spouses age 70
//      AGI 120K = 60K ordinary + 10K dividends + 20K LTCG + 30K taxable SS
//      Retirement breakdown: 20K DB pension + 30K IRA + 10K 401k = 60K
//      (matches the ordinaryIncome bucket, which represents non-wage distributions).
//   2. Wage-earner, single, age 40
//      AGI 100K, all earned income, no SS / no retirement / no cap gains.
//
// These are intentionally generic profiles to exercise:
//   - SS subtraction (profile 1 only)
//   - Retirement-income subtraction (profile 1 only)
//   - LTCG carve-outs (profile 1 only)
//   - Std deduction / exemption age-65+ adders (profile 1 only)
//   - Plain bracket math (profile 2)

import type { ComputeStateIncomeTaxInput } from "../../compute";
import type { FilingStatus } from "@/lib/tax/types";

export const RETIREE_MFJ_AGE70 = (
  state: ComputeStateIncomeTaxInput["state"],
  year: number,
): ComputeStateIncomeTaxInput => ({
  state,
  year,
  filingStatus: "married_joint" as FilingStatus,
  primaryAge: 70,
  spouseAge: 70,
  federalIncome: {
    agi: 120_000,
    taxableIncome: 100_000,
    ordinaryIncome: 60_000,
    earnedIncome: 0,
    dividends: 10_000,
    capitalGains: 20_000,
    shortCapitalGains: 0,
    taxableSocialSecurity: 30_000,
    taxExemptIncome: 0,
  },
  retirementBreakdown: { db: 20_000, ira: 30_000, k401: 10_000, annuity: 0 },
  preTaxContrib: 0,
  fallbackFlatRate: 0,
});

export const WAGE_EARNER_SINGLE_AGE40 = (
  state: ComputeStateIncomeTaxInput["state"],
  year: number,
): ComputeStateIncomeTaxInput => ({
  state,
  year,
  filingStatus: "single" as FilingStatus,
  primaryAge: 40,
  federalIncome: {
    agi: 100_000,
    taxableIncome: 85_000,
    ordinaryIncome: 0,
    earnedIncome: 100_000,
    dividends: 0,
    capitalGains: 0,
    shortCapitalGains: 0,
    taxableSocialSecurity: 0,
    taxExemptIncome: 0,
  },
  retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
  preTaxContrib: 0,
  fallbackFlatRate: 0,
});
