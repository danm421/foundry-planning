import { describe, it, expect } from "vitest";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { applyMutations } from "../apply-mutations";

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [],
    incomes: [], expenses: [], savingsRules: [], liabilities: [], withdrawalStrategy: [],
    entities: [], externalBeneficiaries: [], gifts: [], giftEvents: [],
    taxYearRows: [],
    familyMembers: [
      { id: "fm-client", role: "client", firstName: "Pat", dateOfBirth: "1960-01-01" },
    ],
    ...over,
  } as unknown as ClientData;
}

const ilit: EntitySummary = {
  id: "trust-ilit", name: "Smith ILIT", entityType: "trust",
  isIrrevocable: true, includeInPortfolio: false, isGrantor: false,
  grantor: "client", trustSubType: "ilit", crummeyPowers: true,
};

describe("applyMutations — entity-upsert", () => {
  it("adds a trust entity", () => {
    const out = applyMutations(tree(), [{ kind: "entity-upsert", id: "trust-ilit", value: ilit }]);
    expect(out.entities?.some((e) => e.id === "trust-ilit")).toBe(true);
    expect(out.entities?.find((e) => e.id === "trust-ilit")).toMatchObject({ isIrrevocable: true, trustSubType: "ilit" });
  });

  it("removes a trust entity on null", () => {
    const base = tree({ entities: [ilit] });
    const out = applyMutations(base, [{ kind: "entity-upsert", id: "trust-ilit", value: null }]);
    expect(out.entities?.some((e) => e.id === "trust-ilit")).toBe(false);
  });

  it("resolves an in-kind asset gift that targets a trust added in the same batch", () => {
    const base = tree({ accounts: [{ id: "acct-1", name: "Brokerage", category: "taxable", value: 500_000, owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }] } as never] });
    const assetGift: EstateFlowGift = {
      kind: "asset-once", id: "g-a", year: 2031, accountId: "acct-1", percent: 0.5,
      grantor: "client", recipient: { kind: "entity", id: "trust-idgt" }, eventKind: "outright",
    };
    const idgt: EntitySummary = { id: "trust-idgt", name: "IDGT", entityType: "trust", isIrrevocable: true, includeInPortfolio: false, isGrantor: true, grantor: "client", trustSubType: "idgt" };
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: "trust-idgt", value: idgt },
      { kind: "gift-upsert", id: "g-a", value: assetGift },
    ]);
    expect(out.entities?.some((e) => e.id === "trust-idgt")).toBe(true);
    expect(out.giftEvents.some((e) => e.kind === "asset" && e.accountId === "acct-1" && e.recipientEntityId === "trust-idgt")).toBe(true);
  });
});

describe("applyMutations — ILIT premium-gift fix (live ≡ reload)", () => {
  // policyAccount: minimal life_insurance account sourced from
  // src/lib/insurance-policies/__tests__/premium-gift.test.ts (policyAccount()).
  // Term policy issued 2026 / 20yr / $1,100 premium → premiums 2026..2045.
  // premiumPayer "client" (NOT "owner"). Initially client-owned.
  const policyAccount = {
    id: "policy-1", name: "Term Policy", category: "life_insurance",
    subType: "term",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
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
      premiumPayer: "client",
    },
  } as unknown as Account;

  it("emits Crummey premium gifts when a policy is retitled into an ILIT", () => {
    const base = tree({ accounts: [policyAccount] });
    const before = applyMutations(base, []);
    expect(before.giftEvents.some((e) => e.kind === "cash" && (e as { sourcePolicyAccountId?: string }).sourcePolicyAccountId === "policy-1")).toBe(false);

    const retitled: Account = { ...policyAccount, owners: [{ kind: "entity", entityId: "trust-ilit", percent: 1 }] };
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: "trust-ilit", value: ilit },
      { kind: "account-upsert", id: "policy-1", value: retitled },
    ]);
    const crummey = out.giftEvents.filter((e) => e.kind === "cash" && (e as { sourcePolicyAccountId?: string }).sourcePolicyAccountId === "policy-1");
    expect(crummey.length).toBeGreaterThan(0);
    expect(crummey.every((e) => (e as { useCrummeyPowers?: boolean }).useCrummeyPowers === true)).toBe(true);
  });

  it("leaves a non-premium scenario gift untouched (synthesis is additive)", () => {
    const cashGift: EstateFlowGift = { kind: "cash-once", id: "g-c", year: 2030, amount: 25_000, grantor: "client", recipient: { kind: "external_beneficiary", id: "c1" }, crummey: false };
    const out = applyMutations(tree({ externalBeneficiaries: [{ id: "c1", name: "Red Cross", kind: "charity", charityType: "public" }] }), [
      { kind: "gift-upsert", id: "g-c", value: cashGift },
    ]);
    expect(out.giftEvents.some((e) => e.kind === "cash" && e.year === 2030 && e.amount === 25_000)).toBe(true);
  });
});
