import { describe, it, expect } from "vitest";
import { drainLiquidAssets } from "../creditor-payoff";
import type { Account } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

function acct(id: string, category: Account["category"], value: number, ownerKind: "client" | "spouse" = "client"): Account {
  return {
    id,
    name: `Account ${id}`,
    category,
    subType: "generic",
    titlingType: "jtwros",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: ownerKind === "client" ? LEGACY_FM_CLIENT : LEGACY_FM_SPOUSE, percent: 1 }],
  };
}

const always = () => true;

describe("drainLiquidAssets", () => {
  it("returns empty debits + 0 residual when amountNeeded is 0", () => {
    const r = drainLiquidAssets({
      amountNeeded: 0,
      accounts: [acct("c1", "cash", 10_000)],
      accountBalances: { c1: 10_000 },
      eligibilityFilter: always,
    });
    expect(r.debits).toEqual([]);
    expect(r.drainedTotal).toBe(0);
    expect(r.residual).toBe(0);
  });

  it("drains within a single category proportionally", () => {
    const r = drainLiquidAssets({
      amountNeeded: 8_000,
      accounts: [acct("c1", "cash", 10_000), acct("c2", "cash", 30_000)],
      accountBalances: { c1: 10_000, c2: 30_000 },
      eligibilityFilter: always,
    });
    expect(r.debits).toEqual([
      { accountId: "c1", amount: 2_000 },
      { accountId: "c2", amount: 6_000 },
    ]);
    expect(r.drainedTotal).toBeCloseTo(8_000, 2);
    expect(r.residual).toBe(0);
  });

  it("spills across category order: cash → taxable → life_insurance → retirement", () => {
    const accounts = [
      acct("c1", "cash", 5_000),
      acct("t1", "taxable", 10_000),
      acct("li1", "life_insurance", 20_000),
      acct("r1", "retirement", 100_000),
    ];
    const r = drainLiquidAssets({
      amountNeeded: 30_000,
      accounts,
      accountBalances: { c1: 5_000, t1: 10_000, li1: 20_000, r1: 100_000 },
      eligibilityFilter: always,
    });
    expect(r.debits).toEqual([
      { accountId: "c1", amount: 5_000 },
      { accountId: "t1", amount: 10_000 },
      { accountId: "li1", amount: 15_000 },
    ]);
    expect(r.drainedTotal).toBeCloseTo(30_000, 2);
    expect(r.residual).toBe(0);
  });

  it("never touches real_estate or business categories", () => {
    const accounts = [
      acct("re1", "real_estate", 500_000),
      acct("b1", "business", 500_000),
    ];
    const r = drainLiquidAssets({
      amountNeeded: 50_000,
      accounts,
      accountBalances: { re1: 500_000, b1: 500_000 },
      eligibilityFilter: always,
    });
    expect(r.debits).toEqual([]);
    expect(r.drainedTotal).toBe(0);
    expect(r.residual).toBe(50_000);
  });

  it("returns residual when liquid pool is exhausted", () => {
    const r = drainLiquidAssets({
      amountNeeded: 25_000,
      accounts: [acct("c1", "cash", 10_000)],
      accountBalances: { c1: 10_000 },
      eligibilityFilter: always,
    });
    expect(r.debits).toEqual([{ accountId: "c1", amount: 10_000 }]);
    expect(r.drainedTotal).toBeCloseTo(10_000, 2);
    expect(r.residual).toBeCloseTo(15_000, 2);
  });

  it("eligibility filter scopes account pool", () => {
    const accounts = [
      acct("c1", "cash", 10_000, "client"),
      acct("c2", "cash", 10_000, "spouse"),
    ];
    const r = drainLiquidAssets({
      amountNeeded: 5_000,
      accounts,
      accountBalances: { c1: 10_000, c2: 10_000 },
      eligibilityFilter: (a) => a.owners.some(o => o.kind === "family_member" && o.familyMemberId === LEGACY_FM_CLIENT),
    });
    expect(r.debits).toEqual([{ accountId: "c1", amount: 5_000 }]);
  });

  it("excludes zero-balance accounts from the pool", () => {
    const r = drainLiquidAssets({
      amountNeeded: 5_000,
      accounts: [acct("c1", "cash", 0), acct("c2", "cash", 10_000)],
      accountBalances: { c1: 0, c2: 10_000 },
      eligibilityFilter: always,
    });
    expect(r.debits).toEqual([{ accountId: "c2", amount: 5_000 }]);
  });
});

// The eligibility filter is binary: an account the decedent holds 100% on
// paper, with 30% gifted to a trust, still passes it. The fraction is what
// keeps the trust's slice out of the drain.
describe("drainLiquidAssets — fractional drains", () => {
  it("drains only the drainable fraction of an account", () => {
    const r = drainLiquidAssets({
      amountNeeded: 1_000_000,
      accounts: [acct("a1", "cash", 500_000)],
      accountBalances: { a1: 500_000 },
      eligibilityFilter: always,
      drainableFraction: () => 0.7,
    });
    expect(r.drainedTotal).toBeCloseTo(350_000, 2);
    expect(r.residual).toBeCloseTo(650_000, 2);
    expect(r.debits).toHaveLength(1);
    expect(r.debits[0]).toMatchObject({ accountId: "a1" });
    expect(r.debits[0].amount).toBeCloseTo(350_000, 2);
  });

  it("excludes an account whose drainable fraction is 0", () => {
    const r = drainLiquidAssets({
      amountNeeded: 100_000,
      accounts: [acct("a1", "cash", 500_000), acct("a2", "cash", 500_000)],
      accountBalances: { a1: 500_000, a2: 500_000 },
      eligibilityFilter: always,
      drainableFraction: (a) => (a.id === "a1" ? 0 : 1),
    });
    expect(r.debits.map((d) => d.accountId)).toEqual(["a2"]);
  });

  it("pro-rates within a category using the DRAINABLE balance, not the raw one", () => {
    const r = drainLiquidAssets({
      amountNeeded: 100_000,
      accounts: [acct("a1", "cash", 400_000), acct("a2", "cash", 400_000)],
      accountBalances: { a1: 400_000, a2: 400_000 },
      eligibilityFilter: always,
      drainableFraction: (a) => (a.id === "a1" ? 0.25 : 0.75),
    });
    const byId = Object.fromEntries(r.debits.map((d) => [d.accountId, d.amount]));
    expect(byId.a1).toBeCloseTo(25_000, 2);
    expect(byId.a2).toBeCloseTo(75_000, 2);
  });

  it("never drains more than the whole balance, whatever the fraction", () => {
    const r = drainLiquidAssets({
      amountNeeded: 1_000_000,
      accounts: [acct("a1", "cash", 500_000)],
      accountBalances: { a1: 500_000 },
      eligibilityFilter: always,
      drainableFraction: () => 1.2,
    });
    expect(r.drainedTotal).toBeCloseTo(500_000, 2);
    expect(r.residual).toBeCloseTo(500_000, 2);
  });

  it("defaults to whole-balance draining when the fraction is omitted", () => {
    const r = drainLiquidAssets({
      amountNeeded: 1_000_000,
      accounts: [acct("a1", "cash", 500_000)],
      accountBalances: { a1: 500_000 },
      eligibilityFilter: always,
    });
    expect(r.drainedTotal).toBeCloseTo(500_000, 2);
  });
});
