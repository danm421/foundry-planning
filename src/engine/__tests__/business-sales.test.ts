import { describe, it, expect } from "vitest";
import { applyBusinessSales } from "../asset-transactions";
import type { Account, AccountLedger, AssetTransaction, Liability } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeChecking(id: string, balance: number): Account {
  return {
    id,
    name: "Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: balance,
    basis: balance,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
  };
}

function makeBusiness(over: Partial<Account> = {}): Account {
  return {
    id: "biz",
    name: "BobsLLC",
    category: "business",
    subType: "llc",
    titlingType: "jtwros",
    value: 500_000,
    basis: 100_000,
    growthRate: 0,
    rmdEnabled: false,
    parentAccountId: null,
    owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
    ...over,
  };
}

function makeChild(over: Partial<Account>): Account {
  return {
    id: "child",
    name: "Child",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    parentAccountId: "biz",
    owners: [],
    ...over,
  };
}

function makeChildLiability(over: Partial<Liability>): Liability {
  return {
    id: "child-liab",
    name: "Child Liability",
    balance: 100_000,
    interestRate: 0.05,
    monthlyPayment: 600,
    startYear: 2020,
    startMonth: 1,
    termMonths: 360,
    parentAccountId: "biz",
    owners: [],
    extraPayments: [],
    isInterestDeductible: false,
    ...over,
  };
}

function makeLedger(balance: number): AccountLedger {
  return {
    beginningValue: balance,
    growth: 0,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    endingValue: balance,
    entries: [],
    basisBoY: balance,
  };
}

function makeSale(over: Partial<AssetTransaction> = {}): AssetTransaction {
  return {
    id: "tx-1",
    name: "Sell LLC",
    type: "sell",
    year: 2030,
    businessAccountId: "biz",
    fractionSold: 1,
    ...over,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyBusinessSales — operating-value-only case", () => {
  it("full sale of a business with no children realizes operating gain and credits checking", () => {
    const checking = makeChecking("acct-cash", 1_000);
    const business = makeBusiness();
    const accountBalances: Record<string, number> = { "acct-cash": 1_000 };
    const basisMap: Record<string, number> = { "acct-cash": 1_000 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(1_000),
    };

    const result = applyBusinessSales({
      sales: [makeSale()],
      accounts: [checking, business],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // Gain = 500k − 100k = 400k.
    expect(result.capitalGains).toBe(400_000);
    expect(result.capitalGainsByOwner).toEqual({ B: 400_000 });
    expect(result.removedBusinessAccountIds).toEqual(["biz"]);
    expect(result.removedAccountIds).toContain("biz");
    // Net proceeds = 500k (no transaction costs, no child cascade).
    expect(accountBalances["acct-cash"]).toBe(1_000 + 500_000);
    // Business value zeroed.
    expect(business.value).toBe(0);
  });

  it("full sale with 60/40 ownership splits cap gain across owners", () => {
    const checking = makeChecking("acct-cash", 0);
    const business = makeBusiness({
      value: 100_000,
      basis: 0,
      owners: [
        { kind: "family_member", familyMemberId: "B", percent: 0.6 },
        { kind: "family_member", familyMemberId: "M", percent: 0.4 },
      ],
    });
    const accountBalances: Record<string, number> = { "acct-cash": 0 };

    const result = applyBusinessSales({
      sales: [makeSale()],
      accounts: [checking, business],
      liabilities: [],
      accountBalances,
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    expect(result.capitalGains).toBe(100_000);
    expect(result.capitalGainsByOwner["B"]).toBeCloseTo(60_000, 6);
    expect(result.capitalGainsByOwner["M"]).toBeCloseTo(40_000, 6);
  });
});

describe("applyBusinessSales — child cascade", () => {
  it("sells operating value + child cash + child real-estate net of child mortgage", () => {
    const checking = makeChecking("acct-cash", 1_000_000);
    const business = makeBusiness({ value: 100_000, basis: 20_000 });
    const childCash = makeChild({
      id: "child-cash",
      name: "Op Checking",
      category: "cash",
      value: 50_000,
    });
    const childRE = makeChild({
      id: "child-re",
      name: "Office Building",
      category: "real_estate",
      value: 300_000,
      basis: 100_000,
    });
    const childMortgage = makeChildLiability({
      id: "child-mort",
      linkedPropertyId: "child-re",
      balance: 100_000,
    });

    const accountBalances: Record<string, number> = {
      "acct-cash": 1_000_000,
      "child-cash": 50_000,
      "child-re": 300_000,
    };
    const basisMap: Record<string, number> = {
      "acct-cash": 1_000_000,
      "child-cash": 50_000,
      "child-re": 100_000,
    };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(1_000_000),
      "child-cash": makeLedger(50_000),
      "child-re": makeLedger(300_000),
    };

    const result = applyBusinessSales({
      sales: [makeSale()],
      accounts: [checking, business, childCash, childRE],
      liabilities: [childMortgage],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    expect(result.removedBusinessAccountIds).toContain("biz");
    expect(result.removedAccountIds).toEqual(
      expect.arrayContaining(["biz", "child-cash", "child-re"]),
    );
    expect(result.removedLiabilityIds).toContain("child-mort");
    expect(result.diagnostics).toHaveLength(0);
    // Net proceeds = operating(100k) + child-cash(50k) + child-re(300k) − mortgage(100k) = 350k.
    expect(accountBalances["acct-cash"]).toBeCloseTo(1_000_000 + 350_000, 0);
  });
});

describe("applyBusinessSales — partial sale", () => {
  it("at f=0.5 halves business value, child balances, and child liability balance", () => {
    const checking = makeChecking("acct-cash", 0);
    const business = makeBusiness({ value: 100_000, basis: 0 });
    const childCash = makeChild({
      id: "child-cash",
      category: "cash",
      value: 50_000,
    });
    const liab = makeChildLiability({ id: "child-mort", balance: 80_000 });

    const accountBalances: Record<string, number> = {
      "acct-cash": 0,
      "child-cash": 50_000,
    };

    applyBusinessSales({
      sales: [makeSale({ fractionSold: 0.5 })],
      accounts: [checking, business, childCash],
      liabilities: [liab],
      accountBalances,
      basisMap: { "acct-cash": 0, "child-cash": 50_000 },
      accountLedgers: {
        "acct-cash": makeLedger(0),
        "child-cash": makeLedger(50_000),
      },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // Business operating value halved.
    expect(business.value).toBeCloseTo(50_000, 0);
    // Unlinked child liability paid down by f × balance = 40k.
    expect(liab.balance).toBeCloseTo(40_000, 0);
    // Child cash account drained by f via sellAccountFraction.
    expect(accountBalances["child-cash"]).toBeLessThan(50_000);
  });

  it("scales basis with value so a later tranche recognizes the remaining gain", () => {
    const checking = makeChecking("acct-cash", 0);
    const business = makeBusiness({ value: 1_000_000, basis: 600_000 });
    const accountBalances: Record<string, number> = { "acct-cash": 0 };
    const basisMap: Record<string, number> = { "acct-cash": 0 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
    };

    // Tranche 1: sell 50% in 2030 → gain = 0.5 × (1M − 600k) = 200k.
    const first = applyBusinessSales({
      sales: [makeSale({ id: "tx-t1", fractionSold: 0.5, year: 2030 })],
      accounts: [checking, business],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(first.capitalGains).toBeCloseTo(200_000, 0);
    expect(business.value).toBeCloseTo(500_000, 0);
    // Residual keeps the unsold half of the basis, not all of it.
    expect(business.basis).toBeCloseTo(300_000, 0);

    // Tranche 2: sell the residual in 2031 → gain = 500k − 300k = 200k.
    const second = applyBusinessSales({
      sales: [makeSale({ id: "tx-t2", fractionSold: 1, year: 2031 })],
      accounts: [checking, business],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2031,
      defaultCheckingId: "acct-cash",
    });
    expect(second.capitalGains).toBeCloseTo(200_000, 0);
  });
});

describe("applyBusinessSales — diagnostics", () => {
  it("emits business-not-found when the referenced id doesn't match any business", () => {
    const result = applyBusinessSales({
      sales: [makeSale({ businessAccountId: "ghost" })],
      accounts: [makeChecking("acct-cash", 0)],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(result.diagnostics).toEqual([
      { transactionId: "tx-1", reason: "business-not-found" },
    ]);
  });

  it("emits invalid-fraction for fractionSold = 0", () => {
    const result = applyBusinessSales({
      sales: [makeSale({ fractionSold: 0 })],
      accounts: [makeChecking("acct-cash", 0), makeBusiness()],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(result.diagnostics[0]?.reason).toBe("invalid-fraction");
    expect(result.removedBusinessAccountIds).toEqual([]);
  });

  it("emits invalid-fraction for fractionSold > 1", () => {
    const result = applyBusinessSales({
      sales: [makeSale({ fractionSold: 1.5 })],
      accounts: [makeChecking("acct-cash", 0), makeBusiness()],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(result.diagnostics[0]?.reason).toBe("invalid-fraction");
  });

  it("emits business-already-sold on a duplicate full sale in the same year", () => {
    const business = makeBusiness({ value: 100_000, basis: 0 });
    const result = applyBusinessSales({
      sales: [makeSale({ id: "tx-a" }), makeSale({ id: "tx-b" })],
      accounts: [makeChecking("acct-cash", 0), business],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(
      result.diagnostics.find((d) => d.transactionId === "tx-b")?.reason,
    ).toBe("business-already-sold");
  });

  it("emits no-owners when business.owners is empty", () => {
    const result = applyBusinessSales({
      sales: [makeSale()],
      accounts: [makeChecking("acct-cash", 0), makeBusiness({ owners: [] })],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(result.diagnostics[0]?.reason).toBe("no-owners");
  });
});

describe("applyBusinessSales — no-op cases", () => {
  it("skips sales whose year doesn't match", () => {
    const business = makeBusiness();
    const result = applyBusinessSales({
      sales: [makeSale({ year: 2029 })],
      accounts: [makeChecking("acct-cash", 0), business],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(result.removedBusinessAccountIds).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(business.value).toBe(500_000);
  });

  it("skips buy transactions even when they have a businessAccountId", () => {
    const result = applyBusinessSales({
      sales: [makeSale({ type: "buy" })],
      accounts: [makeChecking("acct-cash", 0), makeBusiness()],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });
    expect(result.removedBusinessAccountIds).toEqual([]);
  });
});
