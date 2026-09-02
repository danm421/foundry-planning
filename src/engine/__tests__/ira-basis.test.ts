import { describe, it, expect } from "vitest";
import {
  isTraditionalIra,
  iraPoolKey,
  computeTradIraPool,
  proRataBasisReturn,
} from "../ira-basis";
import type { Account } from "../types";

const acct = (over: Partial<Account> & { id: string }): Account =>
  ({
    name: over.id,
    category: "retirement",
    subType: "traditional_ira",
    value: 0,
    basis: 0,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    ...over,
  }) as Account;

describe("isTraditionalIra", () => {
  it("accepts the three subtypes Form 8606 aggregates", () => {
    for (const subType of ["traditional_ira", "sep_ira", "simple_ira"]) {
      expect(isTraditionalIra({ category: "retirement", subType })).toBe(true);
    }
  });

  // 401(k)/403(b) after-tax dollars live in `rothValue` and are accounted for
  // separately from IRAs. Letting them into the pool would shelter IRA
  // distributions with plan money.
  it("rejects 401k/403b/roth/hsa and every non-retirement category", () => {
    for (const subType of ["401k", "403b", "roth_ira", "hsa", "401a"]) {
      expect(isTraditionalIra({ category: "retirement", subType })).toBe(false);
    }
    expect(isTraditionalIra({ category: "taxable", subType: "traditional_ira" })).toBe(false);
  });
});

describe("computeTradIraPool", () => {
  const balances = { a: 400_000, b: 200_000, spouse: 100_000, k: 500_000 };
  const basisMap = { a: 100_000, b: 50_000, spouse: 40_000, k: 250_000 };
  const accounts = [
    acct({ id: "a" }),
    acct({ id: "b", subType: "sep_ira" }),
    acct({ id: "spouse", owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }] }),
    acct({ id: "k", subType: "401k" }),
  ];

  it("aggregates every Traditional IRA the taxpayer owns", () => {
    expect(computeTradIraPool(accounts, balances, basisMap, "fm-client")).toEqual({
      balance: 600_000,
      basis: 150_000,
    });
  });

  // §408(d)(2) aggregates per individual. Pooling both spouses would let one
  // spouse's post-tax basis shelter the other's distribution.
  it("scopes the pool to ONE taxpayer — a spouse's basis never leaks in", () => {
    expect(computeTradIraPool(accounts, balances, basisMap, "fm-spouse")).toEqual({
      balance: 100_000,
      basis: 40_000,
    });
  });

  it("excludes 401(k) balance and basis even for the same owner", () => {
    const pool = computeTradIraPool(accounts, balances, basisMap, "fm-client");
    expect(pool.balance).not.toBe(1_100_000);
    expect(pool.basis).not.toBe(400_000);
  });

  it("returns an empty pool for malformed ownership rather than pooling globally", () => {
    expect(computeTradIraPool(accounts, balances, basisMap, null)).toEqual({ balance: 0, basis: 0 });
  });

  it("reads LIVE balances/basis, not the Account snapshot", () => {
    const stale = [acct({ id: "a", value: 999_999, basis: 999_999 })];
    expect(computeTradIraPool(stale, { a: 10 }, { a: 4 }, "fm-client")).toEqual({ balance: 10, basis: 4 });
  });
});

describe("iraPoolKey", () => {
  it("resolves the sole family-member owner", () => {
    expect(iraPoolKey(acct({ id: "a" }))).toBe("fm-client");
  });

  it("resolves a fully entity-owned IRA to its entity", () => {
    expect(iraPoolKey(acct({ id: "a", owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }] }))).toBe("trust-1");
  });

  it("returns null on split ownership", () => {
    const split = acct({
      id: "a",
      owners: [
        { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
      ],
    });
    expect(iraPoolKey(split)).toBeNull();
  });
});

describe("proRataBasisReturn", () => {
  it("shelters the basis fraction of the draw (Form 8606)", () => {
    // 150k basis / 600k pool = 25% of every dollar comes out tax-free.
    expect(proRataBasisReturn(100_000, { balance: 600_000, basis: 150_000 })).toBe(25_000);
  });

  it("shelters nothing when the pool holds no post-tax basis", () => {
    expect(proRataBasisReturn(100_000, { balance: 600_000, basis: 0 })).toBe(0);
  });

  it("shelters the whole draw when the pool is entirely post-tax", () => {
    expect(proRataBasisReturn(50_000, { balance: 50_000, basis: 50_000 })).toBe(50_000);
  });

  // A basis above the balance (stale entry, or a pool that shrank on a market
  // loss) must never return more than the draw — that would shelter unrelated
  // income rather than just this distribution.
  it("clamps at the draw when basis exceeds the balance", () => {
    expect(proRataBasisReturn(10_000, { balance: 5_000, basis: 50_000 })).toBe(10_000);
  });

  it("returns 0 for an empty pool or a non-positive draw", () => {
    expect(proRataBasisReturn(10_000, { balance: 0, basis: 0 })).toBe(0);
    expect(proRataBasisReturn(0, { balance: 600_000, basis: 150_000 })).toBe(0);
    expect(proRataBasisReturn(-5, { balance: 600_000, basis: 150_000 })).toBe(0);
  });
});
