// Fixtures for the Withdrawals drill view-model. Only the fields
// `buildWithdrawalReportRows` and `liquidPortfolioBoy` actually read are
// populated; the cast keeps the rest of ProjectionYear out of the way.

import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

export interface YearSpec {
  year: number;
  totalIncome?: number;
  /** Draws keyed by account id. */
  withdrawals?: Record<string, number>;
  /** Per-account RMD amounts, written onto `accountLedgers[id].rmdAmount`. */
  rmds?: Record<string, number>;
  /** End-of-year liquid portfolio — next year's BoY denominator. */
  liquidTotal?: number;
  living?: number;
  totalExpenses?: number;
}

export function makeYear(spec: YearSpec): ProjectionYear {
  const withdrawals = spec.withdrawals ?? {};
  const total = Object.values(withdrawals).reduce((a, b) => a + b, 0);
  const totalIncome = spec.totalIncome ?? 0;
  const totalExpenses = spec.totalExpenses ?? 0;

  const accountLedgers: Record<string, unknown> = {};
  for (const [id, rmdAmount] of Object.entries(spec.rmds ?? {})) {
    accountLedgers[id] = { rmdAmount, beginningValue: 0, endingValue: 0, entries: [] };
  }

  return {
    year: spec.year,
    ages: { client: spec.year - 1966, spouse: spec.year - 1970 },
    withdrawals: { byAccount: withdrawals, total },
    entityWithdrawals: { byAccount: {}, total: 0 },
    expenses: {
      living: spec.living ?? 0,
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      taxes: 0,
      cashGifts: 0,
      discretionary: 0,
      total: totalExpenses,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome,
    totalExpenses,
    netCashFlow: totalIncome - totalExpenses,
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {},
      taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0,
      businessTotal: 0, lifeInsuranceTotal: 0,
      trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
      total: spec.liquidTotal ?? 0,
      liquidTotal: spec.liquidTotal ?? 0,
    },
    accountLedgers,
  } as unknown as ProjectionYear;
}

/** An account owned outright by the client, so `controllingFamilyMember` finds
 *  it and its RMD counts toward the household's withdrawal rate. */
export function makeAccount(
  id: string,
  category: string,
  subType = "",
): Account {
  return {
    id,
    name: id,
    category,
    subType,
    balance: 0,
    // `percent` is a FRACTION and the key is `familyMemberId` — anything else
    // and `controllingFamilyMember` returns null, which silently drops the
    // account's RMD out of the withdrawal-rate numerator.
    owners: [{ kind: "family_member", familyMemberId: "client", percent: 1 }],
  } as unknown as Account;
}

export function makeAccountsAndClient(accounts: Account[]): ClientData {
  return { ...makeClientData(), accounts };
}
