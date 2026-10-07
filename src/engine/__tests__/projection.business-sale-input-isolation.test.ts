/**
 * A business sale must not write through to the caller's account objects.
 *
 * `applyBusinessSales` zeroes (full sale) or scales (partial sale) the sold
 * business's `value`/`basis` on the object it is handed. When that object was
 * the caller's own, the projection left the input tree with the business
 * already sold — so the "if both died today" estate figure computed from the
 * same input after the run, and every later projection over it (Monte Carlo,
 * solvers, a second report page in the same request), saw a $0 business. For a
 * jointly owned one that crashed the final-death invariant: business
 * succession skips a $0 business at the first death, leaving it joint.
 */

import { describe, it, expect } from "vitest";
import { runProjection, runProjectionWithEvents } from "../projection";
import type { Account, AssetTransaction, ClientData, FamilyMember, PlanSettings } from "../types";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2032,
};

const joint = [
  { kind: "family_member" as const, familyMemberId: FM_CLIENT, percent: 0.5 },
  { kind: "family_member" as const, familyMemberId: FM_SPOUSE, percent: 0.5 },
];

function mkData(fractionSold: number | null): ClientData {
  const accounts: Account[] = [
    {
      id: "hh-checking", name: "Household Checking", category: "cash", subType: "checking",
      titlingType: "jtwros", value: 100_000, basis: 100_000, growthRate: 0, rmdEnabled: false,
      owners: joint, isDefaultChecking: true,
    } as Account,
    {
      id: "biz", name: "Joint LLC", category: "business", subType: "llc",
      value: 1_000_000, basis: 200_000, growthRate: 0, rmdEnabled: false, businessType: "llc",
      parentAccountId: null, flowMode: "annual", businessTaxTreatment: "qbi", owners: joint,
    } as Account,
  ];
  const sale = {
    id: "sale", name: "Sell the LLC", type: "sell", year: 2029,
    accountId: null, businessAccountId: "biz", fractionSold,
  } as unknown as AssetTransaction;
  return {
    client: {
      firstName: "Ada", lastName: "Test", dateOfBirth: "1975-06-20", retirementAge: 65,
      planEndAge: 95, filingStatus: "married_joint", spouseName: "Bo Test",
      spouseDob: "1979-01-01", spouseRetirementAge: 65,
    },
    accounts, incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [], planSettings, entities: [], giftEvents: [],
    assetTransactions: [sale],
    familyMembers: [
      { id: FM_CLIENT, firstName: "Ada", lastName: "Test", relationship: "other", role: "client", dateOfBirth: "1975-06-20" } as FamilyMember,
      { id: FM_SPOUSE, firstName: "Bo", lastName: "Test", relationship: "other", role: "spouse", dateOfBirth: "1979-01-01" } as FamilyMember,
    ],
    externalBeneficiaries: [],
  } as unknown as ClientData;
}

const bizOf = (data: ClientData) => data.accounts.find((a) => a.id === "biz")!;

describe("business sale leaves the projection input untouched", () => {
  it.each([
    ["full", null],
    ["partial", 0.4],
  ])("a %s sale keeps the caller's business value and basis", (_label, fractionSold) => {
    const data = mkData(fractionSold);
    runProjection(data);
    expect(bizOf(data).value).toBe(1_000_000);
    expect(bizOf(data).basis).toBe(200_000);
  });

  it("values a jointly owned business sold later in the 'if both died today' estate", () => {
    const result = runProjectionWithEvents(mkData(null));
    const transfers = result.todayHypotheticalEstateTax.primaryFirst.firstDeathTransfers;
    expect(transfers.some((t) => t.sourceAccountId === "biz" && t.amount === 500_000)).toBe(true);
  });

  it("projects the same numbers when run twice over one input", () => {
    const data = mkData(null);
    const first = runProjection(data).map((y) => y.portfolioAssets);
    const second = runProjection(data).map((y) => y.portfolioAssets);
    expect(second).toEqual(first);
  });
});
