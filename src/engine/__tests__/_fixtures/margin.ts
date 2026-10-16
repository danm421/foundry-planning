import { runProjection } from "../../projection";
import { buildClientData, basePlanSettings } from "../fixtures";
import { LEGACY_FM_CLIENT } from "../../ownership";
import type { Account, ClientData, Expense, PlanSettings } from "../../types";

export const MARGINED: Account = {
  id: "acct-margin", name: "Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros", value: 10_000_000, basis: 10_000_000, growthRate: 0.07, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  marginBalance: 2_000_000, marginInterestRate: 0.02, marginCallPct: 0.3,
};

export function runMargin(accounts: Account[], years = 2, planSettings = {}, data: Partial<ClientData> = {}) {
  return runProjection(buildClientData({
    accounts, incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 + years - 1, ...planSettings },
    ...data,
  }));
}

/** Household checking — routes the plan through the household-checking path,
 *  the only path that borrows. */
export const CHECKING: Account = {
  id: "acct-checking", name: "Household Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

/** Spec 2026-10-14 worked examples: $1M of securities, $400K basis, no loan, 8%. */
export const BORROWER: Account = {
  id: "acct-borrow", name: "Schwab Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros", value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  marginBalance: 0, marginInterestRate: 0.08, marginCallPct: 0.3, marginBorrowEnabled: true,
};

export function spending(annualAmount: number): Expense {
  return { id: "exp-living", type: "living", name: "Living Expenses", annualAmount, startYear: 2026, endYear: 2080, growthRate: 0 };
}

/** No income, flat tax at 0% unless overridden, one living expense: the
 *  shortfall each year is exactly the expense. */
export function runBorrow(
  accounts: Account[],
  opts: { years?: number; spend?: number; planSettings?: Partial<PlanSettings>; data?: Partial<ClientData> } = {},
) {
  return runMargin([CHECKING, ...accounts], opts.years ?? 2,
    { flatFederalRate: 0, flatStateRate: 0, ...opts.planSettings },
    { expenses: [spending(opts.spend ?? 100_000)], ...opts.data });
}
