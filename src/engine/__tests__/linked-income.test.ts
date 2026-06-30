import { describe, it, expect } from "vitest";
import { expandLinkedIncome, expandLinkedIncomes, survivingSaleFraction, type LinkedIncomeContext } from "../linked-income";
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

  it("scheduleOverrides are scaled per era and clipped to the era window", () => {
    // 100% CLIENT-owned, partial 50% sale at 2030 → era1 factor 1.0, era2 factor 0.5.
    const property = prop([{ kind: "family_member", familyMemberId: CLIENT, percent: 1 }]);
    const assetTransactions: AssetTransaction[] = [{ id: "s", name: "sell", type: "sell", year: 2030, accountId: "re-1", fractionSold: 0.5 }];
    // One override in era1 (2028) and one in era2 (2031); both inside the 2026-2035 window.
    const income: Income = { ...baseIncome, scheduleOverrides: { 2028: 60000, 2031: 60000 } };
    const out = expandLinkedIncome(income, ctx({ property, assetTransactions }));

    const e1 = out.find((s) => s.startYear === 2026)!;
    expect(e1.endYear).toBe(2029);
    // era1 factor = surviving(1.0) × householdShare(1.0) = 1.0; 2028 unscaled, 2031 clipped out.
    expect(e1.scheduleOverrides).toEqual({ 2028: 60000 });

    const e2 = out.find((s) => s.startYear === 2030)!;
    expect(e2.endYear).toBe(2035);
    // era2 factor = surviving(0.5) × householdShare(1.0) = 0.5; 2031 scaled to 30000, 2028 clipped out.
    expect(e2.scheduleOverrides).toEqual({ 2031: 30000 });
  });
});

describe("expandLinkedIncomes", () => {
  it("expands linked 'other' income and passes other incomes through unchanged", () => {
    const property = prop([{ kind: "family_member", familyMemberId: CLIENT, percent: 1 }]);
    const salary: Income = {
      id: "inc-salary",
      type: "salary",
      name: "Salary",
      annualAmount: 120000,
      startYear: 2026,
      endYear: 2040,
      growthRate: 0,
      owner: "client",
    };
    // A non-"other" income with a stray linkedPropertyId must NOT be expanded.
    const strayLinked: Income = { ...salary, id: "inc-stray", linkedPropertyId: "re-1" };
    const out = expandLinkedIncomes([baseIncome, salary, strayLinked], ctx({ property }));

    // baseIncome (linked other) → one client slice; salary + strayLinked pass through unchanged.
    const expanded = out.filter((i) => i.id.startsWith("inc-1::"));
    expect(expanded).toHaveLength(1);
    expect(expanded[0].owner).toBe("client");
    expect(expanded[0].annualAmount).toBe(60000);

    const passthroughSalary = out.find((i) => i.id === "inc-salary")!;
    expect(passthroughSalary).toBe(salary); // same object reference, untouched
    const passthroughStray = out.find((i) => i.id === "inc-stray")!;
    expect(passthroughStray).toBe(strayLinked); // same object reference, untouched
  });
});
