import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { Account, ClientData, ClientInfo, FamilyMember, GiftEvent, PlanSettings } from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

// Regression: a one-time cash gift to a FAMILY MEMBER (e.g. an adult child) —
// i.e. recipient is NOT a modeled trust entity, so recipientEntityId is absent.
// This must still leave the grantor's portfolio: debit the household source
// account and surface on the cashflow report (expenses.cashGifts), exactly like
// a gift to a trust does. Repro of the Doyle bug: $150k gifts to two children
// were silently dropped because the engine bailed when no trust-checking
// account resolved for the recipient.

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Frank", lastName: "Doyle", dateOfBirth: "1953-01-01",
};

const planSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2028,
};

// Single household checking account, no growth, no income/expenses/taxes — so
// the only thing that can move the portfolio is the gift.
const accounts: Account[] = [
  {
    id: "checking", name: "Household Checking",
    category: "cash", subType: "checking",
    titlingType: "jtwros",
    value: 1_000_000, basis: 1_000_000,
    growthRate: 0, rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  },
];

const client: ClientInfo = {
  firstName: "Frank", lastName: "Doyle",
  dateOfBirth: "1953-01-01",
  retirementAge: 65, planEndAge: 75,
  filingStatus: "single",
};

// Cash gift to a child in 2027 — no recipientEntityId (not a trust).
const giftEvents: GiftEvent[] = [
  {
    kind: "cash",
    year: 2027,
    amount: 150_000,
    grantor: "client",
    useCrummeyPowers: false,
  },
];

describe("cash gift to a family member (non-trust recipient)", () => {
  const data: ClientData = {
    client,
    accounts,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [clientFm],
    giftEvents,
  };

  const years = runProjection(data);
  const y2026 = years.find((y) => y.year === 2026)!;
  const y2027 = years.find((y) => y.year === 2027)!;

  it("surfaces the gift on the cashflow report in the gift year", () => {
    expect(y2027.expenses.cashGifts).toBe(150_000);
  });

  it("lowers portfolio assets by the gift amount", () => {
    // No other flows, no growth → portfolio drops by exactly the gift.
    expect(y2026.portfolioAssets.liquidTotal).toBe(1_000_000);
    expect(y2027.portfolioAssets.liquidTotal).toBe(850_000);
  });
});
