// A REAL engine projection (not hand-made year rows) with more than four
// drawable accounts, so "Other accounts" appears.
import { runProjection } from "@/engine/projection";
import { buildClientData, sampleAccounts } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import type { Account, ClientData, Expense } from "@/engine/types";

const owner = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];

const checking: Account = {
  id: "acct-checking", name: "Joint Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 10_000, basis: 10_000, growthRate: 0, rmdEnabled: false,
  isDefaultChecking: true, owners: owner,
};
const extraBrokerage = (id: string, name: string, value: number): Account => ({
  id, name, category: "taxable", subType: "brokerage", titlingType: "jtwros",
  value, basis: value, growthRate: 0.04, rmdEnabled: false, owners: owner,
});

const living: Expense = {
  id: "exp-living", type: "living", name: "Living Expenses", annualAmount: 150_000,
  startYear: 2026, endYear: 2060, growthRate: 0.03,
};

export function makeRealDistributionsFixture(): { clientData: ClientData; years: ReturnType<typeof runProjection> } {
  const clientData = buildClientData({
    accounts: [
      checking,
      ...sampleAccounts,
      extraBrokerage("acct-b2", "Second Brokerage", 400_000),
      extraBrokerage("acct-b3", "Third Brokerage", 300_000),
    ],
    expenses: [living],
  });
  return { clientData, years: runProjection(clientData) };
}
