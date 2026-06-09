import { describe, it, expect } from "vitest";
import { synthesizePremiumExpenses } from "../premium-expense";
import type { PremiumGiftContext } from "../premium-gift";
import type { Account } from "@/engine/types";

const CHILD_FM = "fm-child";
const TRUST = "trust-1";

function policy(owners: Account["owners"], premiumPayer: "owner" | "client"): Account {
  return {
    id: "pol-1", name: "Policy", category: "life_insurance", subType: "term",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "jtwros", owners,
    lifeInsurance: {
      faceValue: 1_000_000, costBasis: 0, premiumAmount: 1100, premiumYears: null,
      policyType: "term", termIssueYear: 2026, termLengthYears: 20,
      endsAtInsuredRetirement: false, cashValueGrowthMode: "basic",
      premiumScheduleMode: "off", deathBenefitScheduleMode: "off", incomeScheduleMode: "off",
      postPayoutGrowthRate: 0.06, cashValueSchedule: [], premiumPayer,
    },
  } as Account;
}

const baseInput = {
  currentYear: 2026, clientBirthYear: 1980, spouseBirthYear: 1982,
  lifeExpectancyClient: 90, lifeExpectancySpouse: 90,
  clientRetirementAge: 65, spouseRetirementAge: 65,
};
const giftContext: PremiumGiftContext = {
  principalFamilyMemberIds: new Set(["fm-client", "fm-spouse"]),
  crummeyByEntityId: new Map([[TRUST, true]]),
};

describe("synthesizePremiumExpenses suppression", () => {
  it("suppresses the household expense for an individual-owned gift policy", () => {
    const acct = policy([{ kind: "family_member", familyMemberId: CHILD_FM, percent: 1 }], "client");
    const out = synthesizePremiumExpenses({ ...baseInput, accounts: [acct], giftContext });
    expect(out).toHaveLength(0);
  });

  it("keeps the entity expense for a trust-owned gift policy", () => {
    const acct = policy([{ kind: "entity", entityId: TRUST, percent: 1 }], "client");
    const out = synthesizePremiumExpenses({ ...baseInput, accounts: [acct], giftContext });
    expect(out).toHaveLength(1);
    expect(out[0].ownerEntityId).toBe(TRUST);
  });

  it("keeps the household expense when there is no gift context (back-compat)", () => {
    const acct = policy([{ kind: "family_member", familyMemberId: CHILD_FM, percent: 1 }], "client");
    const out = synthesizePremiumExpenses({ ...baseInput, accounts: [acct] });
    expect(out).toHaveLength(1);
  });
});
