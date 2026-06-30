import { describe, it, expect } from "vitest";
import { expandLinkedIncome, survivingSaleFraction, type LinkedIncomeContext } from "../linked-income";
import type { Account, AssetTransaction, GiftEvent, Income } from "../types";

const CLIENT = "fm-client";
const SPOUSE = "fm-spouse";
const TRUST = "trust-1";

function ctx(over: Partial<LinkedIncomeContext> & { property: Account }): LinkedIncomeContext {
  const { property, ...rest } = over;
  return {
    accountById: new Map([[property.id, property]]),
    giftEvents: [],
    assetTransactions: [],
    planStartYear: 2026,
    clientFmId: CLIENT,
    spouseFmId: SPOUSE,
    ...rest,
  };
}

function prop(owners: Account["owners"]): Account {
  // Minimal real_estate account; only id/category/owners are read by the resolver.
  return { id: "re-1", name: "Rental", category: "real_estate", subType: "rental_property", value: 0, basis: 0, growthRate: 0, titlingType: "jtwros", owners } as Account;
}

const baseIncome: Income = {
  id: "inc-1",
  type: "other",
  name: "Rental Real Estate",
  annualAmount: 60000,
  startYear: 2026,
  endYear: 2035,
  growthRate: 0,
  owner: "joint",
  linkedPropertyId: "re-1",
};

describe("survivingSaleFraction", () => {
  it("is 1 before any sale", () => {
    expect(survivingSaleFraction([], "re-1", 2030)).toBe(1);
  });
  it("is 0 from a full sale year onward", () => {
    const txns: AssetTransaction[] = [{ id: "s", name: "sell", type: "sell", year: 2030, accountId: "re-1", fractionSold: null }];
    expect(survivingSaleFraction(txns, "re-1", 2029)).toBe(1);
    expect(survivingSaleFraction(txns, "re-1", 2030)).toBe(0);
  });
  it("compounds sequential partial sales", () => {
    const txns: AssetTransaction[] = [
      { id: "a", name: "sell", type: "sell", year: 2030, accountId: "re-1", fractionSold: 0.5 },
      { id: "b", name: "sell", type: "sell", year: 2033, accountId: "re-1", fractionSold: 0.5 },
    ];
    expect(survivingSaleFraction(txns, "re-1", 2031)).toBeCloseTo(0.5);
    expect(survivingSaleFraction(txns, "re-1", 2034)).toBeCloseTo(0.25);
  });
});

describe("expandLinkedIncome", () => {
  it("household-owned the whole plan → one joint slice, full amount", () => {
    const property = prop([
      { kind: "family_member", familyMemberId: CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: SPOUSE, percent: 0.5 },
    ]);
    const out = expandLinkedIncome(baseIncome, ctx({ property }));
    expect(out).toHaveLength(1);
    expect(out[0].owner).toBe("joint");
    expect(out[0].ownerEntityId).toBeUndefined();
    expect(out[0].annualAmount).toBe(60000);
    expect(out[0].startYear).toBe(2026);
    expect(out[0].endYear).toBe(2035);
  });

  it("100% trust-owned → one entity slice routed to the trust", () => {
    const property = prop([{ kind: "entity", entityId: TRUST, percent: 1 }]);
    const out = expandLinkedIncome(baseIncome, ctx({ property }));
    expect(out).toHaveLength(1);
    expect(out[0].ownerEntityId).toBe(TRUST);
    expect(out[0].annualAmount).toBe(60000);
  });

  it("50% gifted to a trust in 2030 → household slice halves at 2030 + trust slice", () => {
    const property = prop([
      { kind: "family_member", familyMemberId: CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: SPOUSE, percent: 0.5 },
    ]);
    const giftEvents: GiftEvent[] = [{ kind: "asset", year: 2030, accountId: "re-1", percent: 0.5, grantor: "client", recipientEntityId: TRUST }];
    const out = expandLinkedIncome(baseIncome, ctx({ property, giftEvents }));
    // Era 1 (2026-2029): full household. Era 2 (2030-2035): 50% household + 50% trust.
    const e1 = out.find((s) => s.startYear === 2026)!;
    expect(e1.endYear).toBe(2029);
    expect(e1.annualAmount).toBe(60000);
    expect(e1.ownerEntityId).toBeUndefined();
    const hh2 = out.find((s) => s.startYear === 2030 && s.ownerEntityId === undefined)!;
    expect(hh2.annualAmount).toBeCloseTo(30000);
    const tr2 = out.find((s) => s.startYear === 2030 && s.ownerEntityId === TRUST)!;
    expect(tr2.annualAmount).toBeCloseTo(30000);
  });

  it("full sale in 2030 → income stops (no slices from 2030)", () => {
    const property = prop([{ kind: "family_member", familyMemberId: CLIENT, percent: 1 }]);
    const assetTransactions: AssetTransaction[] = [{ id: "s", name: "sell", type: "sell", year: 2030, accountId: "re-1", fractionSold: null }];
    const out = expandLinkedIncome(baseIncome, ctx({ property, assetTransactions }));
    expect(out.every((s) => s.endYear < 2030)).toBe(true);
    expect(out.find((s) => s.startYear === 2026)!.owner).toBe("client");
  });

  it("partial 50% sale in 2030 → amount halves from 2030", () => {
    const property = prop([{ kind: "family_member", familyMemberId: CLIENT, percent: 1 }]);
    const assetTransactions: AssetTransaction[] = [{ id: "s", name: "sell", type: "sell", year: 2030, accountId: "re-1", fractionSold: 0.5 }];
    const out = expandLinkedIncome(baseIncome, ctx({ property, assetTransactions }));
    const after = out.find((s) => s.startYear === 2030)!;
    expect(after.annualAmount).toBeCloseTo(30000);
  });

  it("gifted to a person in 2030 → that share leaves the plan", () => {
    const property = prop([{ kind: "family_member", familyMemberId: CLIENT, percent: 1 }]);
    const giftEvents: GiftEvent[] = [{ kind: "asset", year: 2030, accountId: "re-1", percent: 1, grantor: "client", recipientFamilyMemberId: "kid-1" }];
    const out = expandLinkedIncome(baseIncome, ctx({ property, giftEvents }));
    // Era 1 keeps income; Era 2 (2030+) has no household/entity share → no slices.
    expect(out.every((s) => s.endYear < 2030)).toBe(true);
  });

  it("dangling link (property missing) → passes through unchanged", () => {
    const out = expandLinkedIncome(baseIncome, { ...ctx({ property: prop([]) }), accountById: new Map() });
    expect(out).toEqual([baseIncome]);
  });
});
