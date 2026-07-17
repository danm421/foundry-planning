// src/lib/tax/explain-tax-change/__tests__/fixtures.ts
import type { AccountLedger, ProjectionYear } from "@/engine/types";
import type { TaxResult } from "@/lib/tax/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";

export function makeTaxResult(over?: {
  income?: Partial<TaxResult["income"]>;
  flow?: Partial<TaxResult["flow"]>;
  marginalFederalRate?: number;
  state?: TaxResult["state"];
}): TaxResult {
  return {
    income: {
      earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0, dividends: 0,
      capitalGains: 0, shortCapitalGains: 0, qbi: 0, totalIncome: 0,
      nonTaxableIncome: 0, grossTotalIncome: 0, ...over?.income,
    },
    flow: {
      aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
      belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0, regularTaxCalc: 0,
      amtCredit: 0, taxCredits: 0, regularFederalIncomeTax: 0, capitalGainsTax: 0,
      amtAdditional: 0, niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0,
      totalFederalTax: 0, totalTax: 0, earlyWithdrawalPenalty: 0, ...over?.flow,
    },
    diag: {
      marginalFederalRate: over?.marginalFederalRate ?? 0.22,
      marginalBracketTier: {} as TaxResult["diag"]["marginalBracketTier"],
      incomeBracketsForFiling: [],
      effectiveFederalRate: 0.15,
      bracketsUsed: {} as TaxResult["diag"]["bracketsUsed"],
      inflationFactor: 1,
    },
    state: over?.state,
  };
}

export function makeLedger(over?: Partial<AccountLedger>): AccountLedger {
  return {
    beginningValue: 0, growth: 0, contributions: 0, distributions: 0,
    internalContributions: 0, internalDistributions: 0,
    rmdAmount: 0, fees: 0, endingValue: 0, entries: [], ...over,
  };
}

export function makeTaxDetail(
  bySource: NonNullable<ProjectionYear["taxDetail"]>["bySource"],
): NonNullable<ProjectionYear["taxDetail"]> {
  return {
    earnedIncome: 0, ordinaryIncome: 0, dividends: 0, capitalGains: 0,
    stCapitalGains: 0, qbi: 0, taxExempt: 0, taxExemptInterest: 0, bySource,
  };
}

export function makeYear(over: Partial<ProjectionYear> & { year: number }): ProjectionYear {
  return {
    ages: { client: 70 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    taxDetail: makeTaxDetail({}),
    taxResult: makeTaxResult(),
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    expenses: { living: 0, liabilities: 0, other: 0, insurance: 0, realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0, total: 0, bySource: {}, byLiability: {}, interestByLiability: {} },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome: 0, totalExpenses: 0, netCashFlow: 0,
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {},
      lifeInsurance: {}, stockOptions: {}, taxableTotal: 0, cashTotal: 0,
      retirementTotal: 0, realEstateTotal: 0, businessTotal: 0,
      lifeInsuranceTotal: 0, stockOptionsTotal: 0,
      trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
      total: 0, liquidTotal: 0,
    },
    accountLedgers: {},
    accountBasisBoY: {},
    liabilityBalancesBoY: {},
    hypotheticalEstateTax: {} as ProjectionYear["hypotheticalEstateTax"],
    entityCashFlow: new Map(),
    charitableOutflows: 0,
    ...over,
  };
}

export const DRILL_CTX: CellDrillContext = {
  accountNames: { brok: "Joint Brokerage", ira: "Dan IRA", cash: "Checking" },
  incomes: [],
  accounts: [],
};
