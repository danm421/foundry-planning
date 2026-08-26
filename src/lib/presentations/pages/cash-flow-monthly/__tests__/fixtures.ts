// Fixtures for the Monthly Cash Flow view-model. `planSettings` carries a real
// inflation rate and start year — the deflator is the whole point of the
// today's-dollars basis, and an empty planSettings would silently make both
// bases identical.

import type { ClientData, PlanSettings, ProjectionYear } from "@/engine/types";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

export const PLAN_START_YEAR = 2040;
export const INFLATION = 0.03;

export interface MonthlyYearSpec {
  year: number;
  totalIncome?: number;
  taxes?: number;
  liabilities?: number;
  savings?: number;
  insurance?: number;
  realEstate?: number;
  other?: number;
  living?: number;
  discretionary?: number;
  withdrawals?: number;
  /** Household liquid ending balance — drives the depletion flag. */
  endingLiquid?: number;
  totalExpenses?: number;
}

export function makeMonthlyYear(spec: MonthlyYearSpec): ProjectionYear {
  const totalExpenses = spec.totalExpenses ?? 0;
  return {
    year: spec.year,
    ages: { client: spec.year - 1966, spouse: spec.year - 1970 },
    income: {
      salaries: 0, socialSecurity: 0, business: 0, trust: 0,
      deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {},
    },
    withdrawals: { byAccount: {}, total: spec.withdrawals ?? 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    expenses: {
      living: spec.living ?? 0,
      liabilities: spec.liabilities ?? 0,
      other: spec.other ?? 0,
      insurance: spec.insurance ?? 0,
      realEstate: spec.realEstate ?? 0,
      taxes: spec.taxes ?? 0,
      cashGifts: 0,
      discretionary: spec.discretionary ?? 0,
      total: totalExpenses,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    savings: { byAccount: {}, total: spec.savings ?? 0, employerTotal: 0 },
    totalIncome: spec.totalIncome ?? 0,
    totalExpenses,
    netCashFlow: (spec.totalIncome ?? 0) - totalExpenses,
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {},
      taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0,
      businessTotal: 0, lifeInsuranceTotal: 0,
      trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
      total: 0, liquidTotal: 0,
    },
    accountLedgers: {
      chk: {
        beginningValue: 0,
        endingValue: spec.endingLiquid ?? 100_000,
        rmdAmount: 0,
        entries: [],
      },
    },
    syntheticAccounts: [],
  } as unknown as ProjectionYear;
}

/** One household checking account, liquid and client-owned, so the depletion
 *  flag has something to measure. */
export function makeMonthlyClientData(): ClientData {
  const base = makeClientData();
  return {
    ...base,
    accounts: [
      {
        id: "chk",
        name: "Checking",
        category: "cash",
        subType: "checking",
        balance: 100_000,
        owners: [{ kind: "family_member", familyMemberId: "client", percent: 1 }],
      },
    ] as unknown as ClientData["accounts"],
    planSettings: {
      planStartYear: PLAN_START_YEAR,
      inflationRate: INFLATION,
    } as unknown as PlanSettings,
  };
}
