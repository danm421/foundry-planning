import { describe, it, expect } from "vitest";
import type {
  Account,
  ClientData,
  EntitySummary,
  TrustSplitInterestSnapshot,
} from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import {
  applyKindPreset,
  initialAnswers,
  type FundingItem,
  type GuidedTrustAnswers,
  type GuidedTrustKind,
} from "../guided-trust";
import {
  buildFundingMutations,
  buildGuidedTrustBatch,
  buildGuidedTrustEntity,
  fundingItemLabel,
  giftExemptionPreview,
} from "../guided-trust-batch";
import type { SolverMutation } from "../types";

const E = "trust-new";
const RLT = "Rivera Family Revocable Trust";

function account(id: string, name: string, over: Partial<Account> = {}): Account {
  return {
    id, name, category: "taxable", value: 400_000,
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
    ...over,
  } as unknown as Account;
}

const brokerage = () => account("acct-brk", "Joint Brokerage");
const savings = () => account("acct-sav", "Savings", { category: "cash" });
const policy = () =>
  account("acct-pol", "Term Life", {
    category: "life_insurance",
    lifeInsurance: { premiumPayer: "owner" },
  } as Partial<Account>);
const taggedHome = () => account("acct-home", "Home", { category: "real_estate", revocableTrustName: RLT });

function tree(over: Partial<ClientData> & { married?: boolean } = {}): ClientData {
  const { married = true, ...rest } = over;
  return {
    client: {
      firstName: "Alex", lastName: "Rivera", dateOfBirth: "1970-05-01",
      ...(married ? { spouseName: "Jordan", spouseDob: "1972-03-02" } : {}),
    },
    accounts: [brokerage(), savings(), policy(), taggedHome()],
    planSettings: { planStartYear: 2026 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Alex", lastName: "Rivera" },
      ...(married
        ? [{ id: "fm-s", role: "spouse", relationship: "other", firstName: "Jordan", lastName: "Rivera" }]
        : []),
      { id: "fm-kid", role: "child", relationship: "child", firstName: "Sam", lastName: "Rivera" },
    ],
    externalBeneficiaries: [{ id: "ch-old", name: "Red Cross", kind: "charity", charityType: "public" }],
    entities: [],
    wills: [],
    ...rest,
  } as unknown as ClientData;
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const kid = { person: { kind: "family_member" as const, id: "fm-kid" }, percentage: 100 };

/** Answers as the wizard holds them once `kind` is picked: `over`, then the kind's preset. */
function answers(kind: GuidedTrustKind, over: Partial<GuidedTrustAnswers> = {}): GuidedTrustAnswers {
  const start: GuidedTrustAnswers = {
    ...initialAnswers(E),
    lifetime: [kid],
    remainder: [kid],
    name: "Sam Rivera Irrevocable Trust",
    ...over,
  };
  return applyKindPreset(start, kind);
}

function cashGift(over: Partial<Extract<EstateFlowGift, { kind: "cash-once" }>> = {}): EstateFlowGift {
  return {
    kind: "cash-once", id: "g-cash", year: 2026, amount: 1_000_000, grantor: "client",
    recipient: { kind: "entity", id: E }, crummey: true, eventKind: "outright",
    valuationDiscount: 0,
    ...over,
  };
}

const gift = (g: EstateFlowGift): FundingItem => ({ kind: "gift", gift: g });
const retitle = (accountId: string): FundingItem => ({ kind: "retitle", accountId });
const transfer = (accountId: string): FundingItem => ({ kind: "policy", accountId });
const bequestAll: FundingItem = {
  kind: "bequest", from: "client", what: { mode: "all_assets" }, condition: "if_spouse_survives",
};

const kinds = (ms: SolverMutation[]) => ms.map((m) => m.kind);
const valueOf = <T>(m: SolverMutation) => (m as unknown as { value: T }).value;

function snapshot(over: Partial<TrustSplitInterestSnapshot> = {}): TrustSplitInterestSnapshot {
  return {
    inceptionYear: 2026, inceptionValue: 500_000, payoutType: "unitrust", payoutPercent: 0.05,
    payoutAmount: null, irc7520Rate: 0.05, termType: "years", termYears: 20,
    measuringLife1Id: null, measuringLife2Id: null, charityId: "ch-new",
    originalIncomeInterest: 200_000, originalRemainderInterest: 300_000,
    ...over,
  };
}

describe("buildGuidedTrustBatch", () => {
  it("irrevocable + cash gift: the trust, then the gift naming it", () => {
    const a = answers("irrevocable", { funding: [gift(cashGift())] });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual(["entity-upsert", "gift-upsert"]);
    const entity = valueOf<EntitySummary>(batch.mutations[0]);
    expect(entity).toMatchObject({
      id: E, name: "Sam Rivera Irrevocable Trust", entityType: "trust", trustSubType: "irrevocable",
      grantor: "client", isIrrevocable: true, isGrantor: true, crummeyPowers: true,
      accessibleToClient: false,
      incomeBeneficiaries: [{ familyMemberId: "fm-kid", percentage: 100 }],
      remainderBeneficiaries: [{ familyMemberId: "fm-kid", percentage: 100, distributionForm: "outright" }],
    });
    expect(entity).not.toHaveProperty("grantorStatusEndYear");
    expect(valueOf<EstateFlowGift>(batch.mutations[1])).toMatchObject({
      id: "g-cash", recipient: { kind: "entity", id: E }, grantor: "client", crummey: true,
    });
    expect(batch.select).toEqual({ kind: "trust", id: E });
    expect(batch.draft).toEqual({ entity, fundedOriginals: [] });
  });

  it("SLAT with the spouse as grantor: the client benefits now, household access and grantor on", () => {
    // The preset adds the grantor's spouse — here the client — to the lifetime list.
    const a = answers("slat", { grantor: "spouse", lifetime: [] });
    const entity = valueOf<EntitySummary>(buildGuidedTrustBatch(a, tree(), ids()).mutations[0]);

    expect(entity).toMatchObject({
      trustSubType: "irrevocable", grantor: "spouse", isGrantor: true, accessibleToClient: true,
      incomeBeneficiaries: [{ householdRole: "client", percentage: 100 }],
    });
  });

  it("maps every person kind and a grantor-status end year onto the entity", () => {
    const a = answers("irrevocable", {
      grantorStatusEndYear: 2035,
      lifetime: [
        { person: { kind: "household", role: "spouse" }, percentage: 50 },
        { person: { kind: "external", id: "ext-1" }, percentage: 50 },
      ],
      remainder: [
        { person: { kind: "family_member", id: "fm-kid" }, percentage: 60 },
        { person: { kind: "other_heirs" }, percentage: 40 },
      ],
    });
    const entity = buildGuidedTrustEntity(a);

    expect(entity.grantorStatusEndYear).toBe(2035);
    expect(entity.incomeBeneficiaries).toEqual([
      { householdRole: "spouse", percentage: 50 },
      { externalBeneficiaryId: "ext-1", percentage: 50 },
    ]);
    expect(entity.remainderBeneficiaries).toEqual([
      { familyMemberId: "fm-kid", percentage: 60, distributionForm: "outright" },
      { otherHeirs: true, percentage: 40, distributionForm: "outright" },
    ]);
  });

  it("ILIT + policy: the policy names the trust as sole primary beneficiary; the grantor pays premiums", () => {
    const a = answers("ilit", { funding: [transfer("acct-pol")] });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual(["entity-upsert", "account-upsert"]);
    expect(valueOf<EntitySummary>(batch.mutations[0])).toMatchObject({
      trustSubType: "ilit", crummeyPowers: true, isGrantor: false,
    });
    const pol = valueOf<Account>(batch.mutations[1]);
    expect(pol.owners).toEqual([{ kind: "entity", entityId: E, percent: 1 }]);
    expect(pol.beneficiaries).toEqual([
      { id: "id-1", tier: "primary", percentage: 100, entityIdRef: E, sortOrder: 0 },
    ]);
    expect(pol.lifeInsurance?.premiumPayer).toBe("client");
    expect(batch.draft?.fundedOriginals).toEqual([policy()]);
  });

  it("IDGT + gift: a grantor trust without Crummey powers, so the gift carries none", () => {
    const a = answers("idgt", { funding: [gift(cashGift({ crummey: true }))] });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual(["entity-upsert", "gift-upsert"]);
    expect(valueOf<EntitySummary>(batch.mutations[0])).toMatchObject({
      trustSubType: "idgt", isGrantor: true, crummeyPowers: false,
    });
    expect(valueOf<EstateFlowGift>(batch.mutations[1])).toMatchObject({ crummey: false });
  });

  it("irrevocable + retitle: the draft keeps the account as it was before the move", () => {
    const a = answers("irrevocable", { funding: [retitle("acct-brk")] });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual(["entity-upsert", "account-upsert"]);
    expect(valueOf<Account>(batch.mutations[1]).owners).toEqual([
      { kind: "entity", entityId: E, percent: 1 },
    ]);
    expect(batch.draft?.fundedOriginals).toEqual([brokerage()]);
  });

  it("orders every funding kind: trust → accounts → gifts → wills", () => {
    const a = answers("irrevocable", {
      funding: [bequestAll, gift(cashGift()), retitle("acct-brk")],
    });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual([
      "entity-upsert", "account-upsert", "gift-upsert", "will-upsert",
    ]);
    const will = valueOf<{ grantor: string; bequests: { recipients: unknown[] }[] }>(batch.mutations[3]);
    expect(will.grantor).toBe("client");
    expect(will.bequests[0].recipients).toEqual([
      { recipientKind: "entity", recipientId: E, percentage: 100, sortOrder: 0 },
    ]);
  });

  it("CRT with a new charity: the charity first, then the trust, then the retitles", () => {
    const a = answers("crt", {
      name: "Charitable Remainder Trust",
      splitInterest: {
        snapshot: snapshot(),
        fundingAccountIds: ["acct-brk", "acct-sav"],
        newCharity: { id: "ch-new", name: "Food Bank", charityType: "public" },
      },
    });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual([
      "external-beneficiary-upsert", "entity-upsert", "account-upsert", "account-upsert",
    ]);
    expect(batch.mutations[0]).toEqual({
      kind: "external-beneficiary-upsert",
      id: "ch-new",
      value: { id: "ch-new", name: "Food Bank", kind: "charity", charityType: "public" },
    });
    const entity = valueOf<EntitySummary>(batch.mutations[1]);
    expect(entity).toMatchObject({
      trustSubType: "crt", grantor: "client", isGrantor: false, crummeyPowers: false,
      splitInterest: snapshot(),
    });
    expect(entity).not.toHaveProperty("remainderBeneficiaries");
    expect(batch.draft).toEqual({ entity, fundedOriginals: [brokerage(), savings()] });
  });

  it("CRT: a new charity the advisor no longer has selected is not created", () => {
    const a = answers("crt", {
      splitInterest: {
        snapshot: snapshot({ charityId: "ch-old" }),
        fundingAccountIds: ["acct-brk"],
        newCharity: { id: "ch-new", name: "Food Bank", charityType: "public" },
      },
    });
    expect(kinds(buildGuidedTrustBatch(a, tree(), ids()).mutations)).toEqual([
      "entity-upsert", "account-upsert",
    ]);
  });

  it("CLT: retitles, then the remainder-interest gift; heirs from the answers", () => {
    const a = answers("clt", {
      grantor: "spouse",
      remainder: [kid],
      splitInterest: { snapshot: snapshot({ charityId: "ch-old" }), fundingAccountIds: ["acct-brk"], newCharity: null },
    });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(kinds(batch.mutations)).toEqual(["entity-upsert", "account-upsert", "gift-upsert"]);
    const entity = valueOf<EntitySummary>(batch.mutations[0]);
    expect(entity).toMatchObject({
      trustSubType: "clt", grantor: "spouse", isGrantor: true,
      remainderBeneficiaries: [{ familyMemberId: "fm-kid", percentage: 100, distributionForm: "outright" }],
    });
    expect(batch.mutations[2]).toMatchObject({
      kind: "gift-upsert",
      id: "id-1",
      value: {
        kind: "cash-once", year: 2026, amount: 300_000, grantor: "spouse",
        recipient: { kind: "entity", id: E }, crummey: false, eventKind: "clt_remainder_interest",
      },
    });
    expect(batch.draft).toEqual({ entity, fundedOriginals: [brokerage()], remainderGiftId: "id-1" });
  });

  it("revocable: only the accounts whose tag changes; no draft; selects the trust by name", () => {
    const a = answers("revocable", {
      name: ` ${RLT} `,
      revocableAccountIds: ["acct-home", "acct-brk"],
    });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(batch.mutations).toEqual([
      { kind: "account-upsert", id: "acct-brk", value: { ...brokerage(), revocableTrustName: RLT } },
    ]);
    expect(batch.draft).toBeNull();
    expect(batch.select).toEqual({ kind: "revocable", name: RLT });
  });

  it("re-stamps a gift added earlier with the answers' grantor, Crummey and trust", () => {
    const before = cashGift({
      grantor: "client", crummey: false, recipient: { kind: "entity", id: "somewhere-else" },
      valuationDiscount: 0.2,
    });
    const a = answers("irrevocable", { grantor: "spouse", crummeyPowers: true, funding: [gift(before)] });
    const after = valueOf<EstateFlowGift>(buildGuidedTrustBatch(a, tree(), ids()).mutations[1]);

    expect(after).toMatchObject({ grantor: "spouse", crummey: true, recipient: { kind: "entity", id: E } });
    // The unsaved-changes diff compares gifts as JSON, so key order must not move.
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it("re-stamps an asset gift without giving it a Crummey flag", () => {
    const asset: EstateFlowGift = {
      kind: "asset-once", id: "g-asset", year: 2027, accountId: "acct-brk", percent: 0.25,
      grantor: "client", recipient: { kind: "entity", id: E }, valuationDiscount: 0,
    };
    const a = answers("irrevocable", { grantor: "spouse", funding: [gift(asset)] });
    const after = valueOf<EstateFlowGift>(buildGuidedTrustBatch(a, tree(), ids()).mutations[1]);

    expect(after).toEqual({ ...asset, grantor: "spouse" });
  });

  it("collapses two moves of one account, and a move plus a policy transfer, to one mutation", () => {
    const a = answers("ilit", {
      funding: [retitle("acct-brk"), retitle("acct-brk"), transfer("acct-pol"), retitle("acct-pol")],
    });
    const batch = buildGuidedTrustBatch(a, tree(), ids());

    expect(batch.mutations.map((m) => `${m.kind}:${(m as { id: string }).id}`)).toEqual([
      `entity-upsert:${E}`, "account-upsert:acct-brk", "account-upsert:acct-pol",
    ]);
    expect(valueOf<Account>(batch.mutations[2]).beneficiaries?.[0]?.entityIdRef).toBe(E);
    expect(batch.draft?.fundedOriginals).toEqual([brokerage(), policy()]);
  });

  it("skips a move-in for an account that is no longer the household's", () => {
    const held = account("acct-held", "Held", {
      owners: [{ kind: "entity", entityId: "other-trust", percent: 1 }],
    } as Partial<Account>);
    const t = tree({ accounts: [brokerage(), held] });
    const batch = buildGuidedTrustBatch(answers("irrevocable", { funding: [retitle("acct-held")] }), t, ids());

    expect(kinds(batch.mutations)).toEqual(["entity-upsert"]);
    expect(batch.draft?.fundedOriginals).toEqual([]);
  });
});

describe("buildFundingMutations", () => {
  it("funds an existing trust: accounts, then gifts, then wills — no entity upsert", () => {
    const trust = { id: "ilit-base", name: "Rivera ILIT", grantor: "spouse" as const, crummeyPowers: true };
    const { mutations, fundedOriginals } = buildFundingMutations(
      [gift(cashGift({ crummey: false })), bequestAll, transfer("acct-pol")],
      trust,
      tree(),
      ids(),
    );

    expect(kinds(mutations)).toEqual(["account-upsert", "gift-upsert", "will-upsert"]);
    expect(valueOf<Account>(mutations[0]).lifeInsurance?.premiumPayer).toBe("spouse");
    expect(valueOf<EstateFlowGift>(mutations[1])).toMatchObject({
      grantor: "spouse", crummey: true, recipient: { kind: "entity", id: "ilit-base" },
    });
    expect(fundedOriginals).toEqual([policy()]);
  });
});

describe("giftExemptionPreview", () => {
  const ctx = {
    annualExclusionByYear: { 2026: 19_000, 2027: 19_000 },
    crummeyHolders: 2,
    accountValue: (id: string) => (id === "acct-brk" ? 400_000 : 0),
  };

  it("a Crummey cash gift: each holder's exclusion first, the rest from lifetime exemption", () => {
    expect(giftExemptionPreview(cashGift({ amount: 100_000 }), ctx)).toEqual({
      lifetimeUsed: 62_000, annualExcluded: 38_000, perYear: false,
    });
  });

  it("without Crummey powers the whole discounted gift uses lifetime exemption", () => {
    const g = cashGift({ amount: 100_000, crummey: false, valuationDiscount: 0.3 });
    expect(giftExemptionPreview(g, ctx)).toEqual({ lifetimeUsed: 70_000, annualExcluded: 0, perYear: false });
  });

  it("a series previews one year, at its start year", () => {
    const g: EstateFlowGift = {
      kind: "series", id: "g-series", startYear: 2026, endYear: 2040, annualAmount: 50_000,
      amountMode: "fixed", inflationAdjust: false, grantor: "client",
      recipient: { kind: "entity", id: E }, crummey: true,
    };
    expect(giftExemptionPreview(g, ctx)).toEqual({ lifetimeUsed: 12_000, annualExcluded: 38_000, perYear: true });
  });

  it("an asset gift is the account's value × percent, and never takes the exclusion", () => {
    const g: EstateFlowGift = {
      kind: "asset-once", id: "g-asset", year: 2027, accountId: "acct-brk", percent: 0.25,
      grantor: "client", recipient: { kind: "entity", id: E },
    };
    expect(giftExemptionPreview(g, ctx)).toEqual({ lifetimeUsed: 100_000, annualExcluded: 0, perYear: false });
  });
});

describe("fundingItemLabel", () => {
  const t = tree();

  it("labels gifts", () => {
    expect(fundingItemLabel(gift(cashGift()), t)).toBe("Gift $1,000,000 · 2026");
    expect(
      fundingItemLabel(
        gift({
          kind: "asset-once", id: "g", year: 2027, accountId: "acct-brk", percent: 0.25,
          grantor: "client", recipient: { kind: "entity", id: E },
        }),
        t,
      ),
    ).toBe("Gift 25% of Joint Brokerage · 2027");
    expect(
      fundingItemLabel(
        gift({
          kind: "series", id: "g", startYear: 2026, endYear: 2040, annualAmount: 19_000,
          amountMode: "fixed", inflationAdjust: false, grantor: "client",
          recipient: { kind: "entity", id: E }, crummey: true,
        }),
        t,
      ),
    ).toBe("Gift $19,000/yr · 2026–2040");
  });

  it("labels bequests by will and condition", () => {
    expect(fundingItemLabel(bequestAll, t)).toBe("Bequest · everything · Alex's will, if Jordan survives");
    expect(
      fundingItemLabel(
        {
          kind: "bequest", from: "second_death",
          what: { mode: "specific", accountId: "acct-brk", percentage: 50 },
          condition: "if_spouse_predeceased",
        },
        t,
      ),
    ).toBe("Bequest · 50% of Joint Brokerage · whoever dies second");
    expect(
      fundingItemLabel(
        { kind: "bequest", from: "spouse", what: { mode: "all_assets" }, condition: "if_spouse_predeceased" },
        t,
      ),
    ).toBe("Bequest · everything · Jordan's will, if Alex has died");
    expect(
      fundingItemLabel({ kind: "bequest", from: "client", what: { mode: "all_assets" }, condition: "always" }, t),
    ).toBe("Bequest · everything · Alex's will, either way");
  });

  it("labels transfers and move-ins, falling back when the account is gone", () => {
    expect(fundingItemLabel(transfer("acct-pol"), t)).toBe("Transfer · Term Life");
    expect(fundingItemLabel(retitle("acct-brk"), t)).toBe("Move in · Joint Brokerage");
    expect(fundingItemLabel(retitle("acct-gone"), t)).toBe("Move in · an account");
  });
});
