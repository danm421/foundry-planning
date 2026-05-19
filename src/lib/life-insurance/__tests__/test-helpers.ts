/**
 * Shared fixtures for life-insurance solver tests (Tasks 6, 12, 15).
 *
 * WHY these assumption values:
 *   - deathYear: 2030 (4 years from planStartYear=2026, early-death scenario)
 *   - proceedsGrowthRate: 0.05 (5% post-payout growth rate on proceeds)
 *   - livingExpenseAtDeath: null (no override; survivor keeps base expenses)
 *   - payoffLiabilityIds: [] (no debts in base fixture)
 *
 *   leaveToHeirsAmount: 15_000_000 chosen because:
 *     - ending(0) ≈ $8,362,733 — survivor's portfolio without any insurance.
 *       This is LESS than 15M, so the first test (faceValue > 0) is genuine —
 *       the solver must find a positive face value.
 *     - ending(CAP=20M) ≈ $113,429,692 — far exceeds 15M, so the target IS
 *       reachable within the cap (no false exceeds-cap).
 *     - For the exceeds-cap test we use leaveToHeirsAmount: 10_000_000_000
 *       ($10B), which ending(CAP) cannot reach — a genuine cap-breach.
 */

import type { ClientData } from "@/engine/types";
import {
  baseClient,
  basePlanSettings,
  sampleAccounts,
  sampleFamilyMembers,
} from "@/engine/__tests__/fixtures";
import type { LifeInsuranceAssumptions } from "../solve-need";

export function marriedBase(): ClientData {
  return {
    client: {
      ...baseClient,
      dateOfBirth: "1970-01-01",
      filingStatus: "married_joint",
      lifeExpectancy: 90,
      spouseName: "Spouse",
      spouseDob: "1972-01-01",
      spouseLifeExpectancy: 92,
    },
    accounts: sampleAccounts,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2070 },
    familyMembers: sampleFamilyMembers,
    entities: [],
    giftEvents: [],
  } as ClientData;
}

/**
 * Default assumptions for solver tests.
 *
 * leaveToHeirsAmount is 15_000_000 because:
 *   - ending(faceValue=0) ≈ $8.36M < $15M → solver must find a positive face value
 *   - ending(faceValue=CAP=20M) ≈ $113M > $15M → target is reachable within cap
 */
export const assumptions: LifeInsuranceAssumptions = {
  deathYear: 2030,
  proceedsGrowthRate: 0.05,
  leaveToHeirsAmount: 15_000_000,
  livingExpenseAtDeath: null,
  payoffLiabilityIds: [],
};

/**
 * Married fixture scaled to a high net worth — accounts are 8× the base
 * fixture so the household's estate clears the federal exemption at the
 * survivor's projected death and a genuine estate tax (and IRD on the
 * traditional retirement accounts) is owed. Used by the estate-tax-addend
 * tests and the cover-estate-taxes integration test.
 */
export function highNetWorthBase(): ClientData {
  const base = marriedBase();
  return {
    ...base,
    accounts: base.accounts.map((a) => ({ ...a, value: a.value * 8 })),
  };
}

/** Assumptions for the high-net-worth fixture (same knobs as `assumptions`). */
export const hnwAssumptions: LifeInsuranceAssumptions = {
  ...assumptions,
  leaveToHeirsAmount: 5_000_000,
};
