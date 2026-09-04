import { emptyTaxReturnFacts, type TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { EngineYear, PlanIncome, PlanSnapshot, ReconciliationInput } from "../types";

export const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

export function planFixture(over: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    client: { filingStatus: "married_joint", dateOfBirth: "1960-04-02", spouseDob: "1962-09-15" },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.03, residenceState: "PA", capitalLossCarryforwardLt: null, capitalLossCarryforwardSt: null },
    incomes: [], expenses: [], savingsRules: [], accounts: [], entities: [], deductions: [],
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", dateOfBirth: "1960-04-02", claimedAsDependent: "auto" },
      { id: "fm-s", role: "spouse", relationship: "other", dateOfBirth: "1962-09-15", claimedAsDependent: "auto" },
    ],
    medicare: [],
    ...over,
  };
}

export function income(over: Partial<PlanIncome> & { id: string; type: PlanIncome["type"]; name: string; annualAmount: number }): PlanIncome {
  return {
    growthRate: 0.03, startYear: 2026, endYear: 2060, inflationStartYear: null, owner: "client",
    ownerAccountId: null, ownerEntityId: null, linkedPropertyId: null, ssBenefitMode: null, piaMonthly: null, claimingAge: null,
    ...over,
  };
}

/** A minimal engine year: every figure zero unless overridden. Cast once here so
 *  rule tests never repeat the Pick's full shape. */
export function engineYearFixture(over: Partial<EngineYear> = {}): EngineYear {
  const base = {
    year: 2026,
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    taxDetail: { earnedIncome: 0, ordinaryIncome: 0, dividends: 0, capitalGains: 0, stCapitalGains: 0, qbi: 0, taxExempt: 0, taxExemptInterest: 0, bySource: {} },
    taxResult: undefined,
    deductionBreakdown: undefined,
    withdrawals: { byAccount: {}, total: 0 },
    expenses: { living: 0, liabilities: 0, other: 0, insurance: 0, realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0, total: 0, bySource: {}, byLiability: {}, interestByLiability: {} },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    accountLedgers: {},
  };
  return { ...base, ...over } as EngineYear;
}

export function inputFixture(over: Partial<ReconciliationInput> = {}): ReconciliationInput {
  const taxYear = over.taxYear ?? 2025;
  const facts: TaxReturnFacts = over.facts ?? emptyTaxReturnFacts(taxYear);
  return {
    clientId: CLIENT_ID, taxYear, planYear: 2026, facts, w2s: [],
    plan: planFixture(), engineYear: null, stateTaxEstimate: 0, ficaEstimate: 0,
    ...over,
  };
}
