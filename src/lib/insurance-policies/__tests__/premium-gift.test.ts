import { describe, it, expect } from "vitest";
import {
  planPremiumGift,
  synthesizePremiumGifts,
  withSynthesizedPremiumGifts,
  type PremiumGiftContext,
} from "../premium-gift";
import type { Account, ClientData, GiftEvent } from "@/engine/types";

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

const synthInput = {
  currentYear: 2026,
  clientBirthYear: 1980,
  spouseBirthYear: 1982,
  lifeExpectancyClient: 90,
  lifeExpectancySpouse: 90,
  clientRetirementAge: 65,
  spouseRetirementAge: 65,
  giftContext: ctx,
};

describe("synthesizePremiumGifts", () => {
  it("emits one cash gift per premium year for a trust-owned policy", () => {
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "client");
    const gifts = synthesizePremiumGifts({ ...synthInput, accounts: [acct] });
    // term 2026 + 20yr → 2026..2045 inclusive
    expect(gifts).toHaveLength(20);
    expect(gifts[0]).toMatchObject({
      kind: "cash",
      year: 2026,
      amount: 1100,
      grantor: "client",
      recipientEntityId: TRUST,
      useCrummeyPowers: true,
      sourcePolicyAccountId: "pol-1",
    });
  });

  it("emits no gift when payer is owner", () => {
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "owner");
    expect(synthesizePremiumGifts({ ...synthInput, accounts: [acct] })).toHaveLength(0);
  });

  it("individual-owned gift has no recipientEntityId", () => {
    const acct = policyAccount([{ kind: "family_member", familyMemberId: CHILD_FM, percent: 1 }], "client");
    const gifts = synthesizePremiumGifts({ ...synthInput, accounts: [acct] });
    expect(gifts[0].recipientEntityId).toBeUndefined();
    expect(gifts[0].useCrummeyPowers).toBe(false);
  });
});

describe("withSynthesizedPremiumGifts", () => {
  function tree(extraGifts: GiftEvent[]): ClientData {
    const acct = policyAccount([{ kind: "entity", entityId: TRUST, percent: 1 }], "client");
    return {
      client: {
        dateOfBirth: "1980-01-01",
        spouseDob: "1982-01-01",
        retirementAge: 65,
        spouseRetirementAge: 65,
        lifeExpectancy: 90,
        spouseLifeExpectancy: 90,
      },
      accounts: [acct],
      entities: [{ id: TRUST, isGrantor: false, includeInPortfolio: false, crummeyPowers: true }],
      familyMembers: [
        { id: CLIENT_FM, role: "client", relationship: "other", firstName: "C", lastName: null },
        { id: SPOUSE_FM, role: "spouse", relationship: "other", firstName: "S", lastName: null },
      ],
      giftEvents: extraGifts,
    } as unknown as ClientData;
  }

  it("appends policy gifts and is idempotent (strip + re-derive)", () => {
    const userGift: GiftEvent = {
      kind: "cash", year: 2026, amount: 500, grantor: "client", useCrummeyPowers: false,
    };
    const once = withSynthesizedPremiumGifts(tree([userGift]));
    const twice = withSynthesizedPremiumGifts(once);
    const policyGifts = (g: ClientData) => (g.giftEvents ?? []).filter((e) => e.kind === "cash" && e.sourcePolicyAccountId);
    expect(policyGifts(once)).toHaveLength(20);
    expect(policyGifts(twice)).toHaveLength(20); // not 40 — prior policy gifts stripped first
    // user gift preserved
    expect((twice.giftEvents ?? []).some((e) => e.kind === "cash" && e.amount === 500)).toBe(true);
  });
});
