import { runProjection } from "../../projection";
import { buildClientData, basePlanSettings } from "../fixtures";
import { LEGACY_FM_CLIENT } from "../../ownership";
import type { Account, ClientData } from "../../types";

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
