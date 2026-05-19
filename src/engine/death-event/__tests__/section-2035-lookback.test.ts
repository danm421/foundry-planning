import { describe, it, expect } from "vitest";
import { computeSection2035Lookback } from "../section-2035-lookback";
import type { Account, EntitySummary, GiftEvent, LifeInsurancePolicy } from "../../types";

const mkPolicy = (over: Partial<LifeInsurancePolicy> = {}): LifeInsurancePolicy => ({
  faceValue: 1_000_000,
  costBasis: 0,
  premiumAmount: 0,
  premiumYears: null,
  policyType: "term",
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  cashValueGrowthMode: "basic",
  postPayoutGrowthRate: 0,
  postPayoutModelPortfolioId: null,
  cashValueSchedule: [],
  ...over,
});

const trust: EntitySummary = {
  id: "trust-1",
  name: "ILIT",
  includeInPortfolio: false,
  isGrantor: false,
  entityType: "trust",
  isIrrevocable: true,
  grantor: "client",
};

const policyAccount: Account = {
  id: "policy-1",
  name: "Term Policy",
  category: "life_insurance",
  subType: "term",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }],
  insuredPerson: "client",
  lifeInsurance: mkPolicy(),
  titlingType: "jtwros",
};

function assetGift(
  year: number,
  overrides: Partial<Extract<GiftEvent, { kind: "asset" }>> = {},
): GiftEvent {
  return {
    kind: "asset",
    year,
    accountId: "policy-1",
    percent: 1,
    grantor: "client",
    recipientEntityId: "trust-1",
    ...overrides,
  };
}

describe("computeSection2035Lookback", () => {
  it("pulls death benefit into estate when death is in the gift year", () => {
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [assetGift(2030)],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(1);
    expect(r.addBackLines[0].amount).toBe(1_000_000);
  });

  it("pulls into estate when death is 2 years after the gift", () => {
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2032,
      giftEvents: [assetGift(2030)],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(1);
    expect(r.addBackLines[0].amount).toBe(1_000_000);
  });

  it("does NOT pull into estate when death is exactly 3 years later", () => {
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2033,
      giftEvents: [assetGift(2030)],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(0);
    expect(r.giftValueToExclude).toBe(0);
  });

  it("does NOT trigger when grantor differs from deceased", () => {
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [assetGift(2030, { grantor: "spouse" })],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(0);
  });

  it("ignores non-life-insurance asset gifts", () => {
    const nonLi: Account = {
      ...policyAccount,
      id: "cash-1",
      category: "cash",
      lifeInsurance: undefined,
    };
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [assetGift(2030, { accountId: "cash-1" })],
      accounts: [nonLi],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(0);
  });

  it("ignores cash gifts (kind: cash) — never trigger §2035", () => {
    const cashGift: GiftEvent = {
      kind: "cash",
      year: 2030,
      amount: 17_000,
      grantor: "client",
      recipientEntityId: "trust-1",
      useCrummeyPowers: true,
    };
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [cashGift],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(0);
  });

  it("ignores gifts to non-irrevocable-trust recipients", () => {
    const businessEnt: EntitySummary = { ...trust, entityType: "llc", isIrrevocable: false };
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [assetGift(2030)],
      accounts: [policyAccount],
      entities: [businessEnt],
    });
    expect(r.addBackLines).toHaveLength(0);
  });

  it("uses amountOverride for giftValueToExclude when present", () => {
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [assetGift(2030, { amountOverride: 42_000 })],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(1);
    expect(r.addBackLines[0].amount).toBe(1_000_000);
    expect(r.giftValueToExclude).toBe(42_000);
  });

  it("scales face value by gift percent for fractional asset gifts", () => {
    const r = computeSection2035Lookback({
      deceased: "client",
      deathYear: 2030,
      giftEvents: [assetGift(2030, { percent: 0.5, amountOverride: 25_000 })],
      accounts: [policyAccount],
      entities: [trust],
    });
    expect(r.addBackLines).toHaveLength(1);
    expect(r.addBackLines[0].amount).toBe(500_000);
    expect(r.addBackLines[0].percentage).toBe(0.5);
  });
});
