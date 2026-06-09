import { describe, it, expect } from "vitest";
import { planPremiumGift, type PremiumGiftContext } from "../premium-gift";
import type { Account } from "@/engine/types";

const TRUST = "trust-1";
const CLIENT_FM = "fm-client";
const SPOUSE_FM = "fm-spouse";
const CHILD_FM = "fm-child";

function policyAccount(
  owners: Account["owners"],
  premiumPayer: "owner" | "client" | "spouse" | "both",
): Account {
  return {
    id: "pol-1",
    name: "Policy",
    category: "life_insurance",
    subType: "term",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners,
    lifeInsurance: {
      faceValue: 1_000_000,
      costBasis: 0,
      premiumAmount: 1100,
      premiumYears: null,
      policyType: "term",
      termIssueYear: 2026,
      termLengthYears: 20,
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      premiumScheduleMode: "off",
      deathBenefitScheduleMode: "off",
      incomeScheduleMode: "off",
      postPayoutGrowthRate: 0.06,
      cashValueSchedule: [],
      premiumPayer,
    },
  } as Account;
}

const ctx: PremiumGiftContext = {
  principalFamilyMemberIds: new Set([CLIENT_FM, SPOUSE_FM]),
  crummeyByEntityId: new Map([[TRUST, true]]),
};

describe("planPremiumGift", () => {
  it("returns null when payer is the owner", () => {
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "owner");
    expect(planPremiumGift(acct, ctx)).toBeNull();
  });

  it("trust owner + client payer + crummey on → entity gift with crummey", () => {
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "client");
    expect(planPremiumGift(acct, ctx)).toEqual({
      grantor: "client",
      recipient: { kind: "entity", entityId: TRUST },
      useCrummeyPowers: true,
    });
  });

  it("trust owner + crummey off → entity gift, no crummey", () => {
    const noCrummey: PremiumGiftContext = {
      principalFamilyMemberIds: ctx.principalFamilyMemberIds,
      crummeyByEntityId: new Map([[TRUST, false]]),
    };
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "client");
    expect(planPremiumGift(acct, noCrummey)?.useCrummeyPowers).toBe(false);
  });

  it("payer 'both' → joint grantor", () => {
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "both");
    expect(planPremiumGift(acct, ctx)?.grantor).toBe("joint");
  });

  it("principal-owned policy → null (no gift, household already pays)", () => {
    const acct = policyAccount([{ kind: "family_member", familyMemberId: CLIENT_FM, percent: 1 }], "spouse");
    expect(planPremiumGift(acct, ctx)).toBeNull();
  });

  it("joint principal-owned policy → null", () => {
    const acct = policyAccount(
      [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
      ],
      "client",
    );
    expect(planPremiumGift(acct, ctx)).toBeNull();
  });

  it("non-principal individual owner + client payer → individual gift (no crummey)", () => {
    const acct = policyAccount([{ kind: "family_member", familyMemberId: CHILD_FM, percent: 1 }], "client");
    expect(planPremiumGift(acct, ctx)).toEqual({
      grantor: "client",
      recipient: { kind: "individual" },
      useCrummeyPowers: false,
    });
  });

  it("external owner + client payer → individual gift", () => {
    const acct = policyAccount([{ kind: "external_beneficiary", externalBeneficiaryId: "ext-1", percent: 1 }], "client");
    expect(planPremiumGift(acct, ctx)?.recipient).toEqual({ kind: "individual" });
  });
});
