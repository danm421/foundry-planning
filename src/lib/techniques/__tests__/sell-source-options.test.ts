import { describe, it, expect } from "vitest";
import type { Account, Liability } from "@/engine/types";
import {
  buildBusinessSaleOptions,
  businessTotalAssetValue,
  businessTotalDebt,
  isLockedEntityCash,
  sellableAccounts,
  settlementAccounts,
  type SellSourceAccount,
} from "../sell-source-options";

// ── Fixtures ────────────────────────────────────────────────────────────────

function acct(over: Partial<Account> & { id: string; name: string }): Account {
  return {
    category: "taxable",
    subType: "brokerage",
    value: 0,
    basis: 0,
    growthRate: 0.05,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [],
    ...over,
  } as Account;
}

function liab(over: Partial<Liability> & { id: string; name: string }): Liability {
  return {
    balance: 0,
    interestRate: 0.05,
    monthlyPayment: 0,
    startYear: 2020,
    startMonth: 1,
    termMonths: 360,
    extraPayments: [],
    owners: [],
    ...over,
  } as Liability;
}

const nameOf = (id: string) => ({ fm1: "Dana Ray", fm2: "Sam Ray" })[id] ?? id;

// ── isLockedEntityCash ──────────────────────────────────────────────────────

describe("isLockedEntityCash", () => {
  it("locks the auto-provisioned cash bucket inside a business", () => {
    const row: SellSourceAccount = {
      id: "c1", name: "Friends Inc. — Cash", category: "cash", subType: "checking",
      isDefaultChecking: true, parentAccountId: "biz1",
    };
    expect(isLockedEntityCash(row)).toBe(true);
  });

  it("locks the auto-provisioned cash bucket inside a trust", () => {
    const row: SellSourceAccount = {
      id: "c2", name: "Ray Family Trust — Cash", category: "cash", subType: "checking",
      isDefaultChecking: true, isEntityOwned: true,
    };
    expect(isLockedEntityCash(row)).toBe(true);
  });

  it("leaves the household's own default checking alone", () => {
    const row: SellSourceAccount = {
      id: "c3", name: "Joint Checking", category: "cash", subType: "checking",
      isDefaultChecking: true,
    };
    expect(isLockedEntityCash(row)).toBe(false);
  });

  it("leaves a non-default account inside a business sellable", () => {
    const row: SellSourceAccount = {
      id: "c4", name: "LLC Savings", category: "cash", subType: "savings",
      parentAccountId: "biz1",
    };
    expect(isLockedEntityCash(row)).toBe(false);
  });
});

// ── sellableAccounts ────────────────────────────────────────────────────────

describe("sellableAccounts", () => {
  const rows: SellSourceAccount[] = [
    { id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage", value: 500_000 },
    { id: "biz1", name: "Friends Inc.", category: "business", subType: "llc", value: 1_000_000 },
    { id: "bizcash", name: "Friends Inc. — Cash", category: "cash", subType: "checking",
      isDefaultChecking: true, parentAccountId: "biz1" },
    { id: "bizprop", name: "LLC Warehouse", category: "real_estate", subType: "commercial_property",
      value: 800_000, parentAccountId: "biz1" },
    { id: "trustcash", name: "Trust — Cash", category: "cash", subType: "checking",
      isDefaultChecking: true, isEntityOwned: true },
    { id: "childbiz", name: "Subsidiary LLC", category: "business", subType: "llc",
      value: 200_000, parentAccountId: "biz1" },
  ];

  it("drops the locked entity cash buckets", () => {
    const ids = sellableAccounts(rows).map((a) => a.id);
    expect(ids).not.toContain("bizcash");
    expect(ids).not.toContain("trustcash");
  });

  it("drops top-level businesses — they sell through the business cascade", () => {
    expect(sellableAccounts(rows).map((a) => a.id)).not.toContain("biz1");
  });

  it("keeps ordinary accounts and a business's non-cash holdings", () => {
    const ids = sellableAccounts(rows).map((a) => a.id);
    expect(ids).toEqual(["a1", "bizprop", "childbiz"]);
  });
});

// ── buildBusinessSaleOptions ────────────────────────────────────────────────

describe("buildBusinessSaleOptions", () => {
  const accounts: Account[] = [
    acct({
      id: "biz1", name: "Friends Inc.", category: "business", subType: "llc",
      value: 1_000_000, basis: 250_000, businessType: "llc", parentAccountId: null,
      owners: [
        { kind: "family_member", familyMemberId: "fm1", percent: 0.6 },
        { kind: "family_member", familyMemberId: "fm2", percent: 0.4 },
      ],
    }),
    acct({
      id: "bizcash", name: "Friends Inc. — Cash", category: "cash", subType: "checking",
      value: 50_000, parentAccountId: "biz1", isDefaultChecking: true,
    }),
    acct({
      id: "bizprop", name: "LLC Warehouse", category: "real_estate",
      subType: "commercial_property", value: 800_000, basis: 600_000, parentAccountId: "biz1",
    }),
    acct({ id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage", value: 500_000 }),
    acct({
      id: "childbiz", name: "Subsidiary LLC", category: "business", subType: "llc",
      value: 200_000, parentAccountId: "biz1", businessType: "llc",
    }),
  ];
  const liabilities: Liability[] = [
    liab({ id: "l1", name: "Warehouse Mortgage", balance: 400_000, parentAccountId: "biz1" }),
    liab({ id: "l2", name: "Home Mortgage", balance: 300_000 }),
  ];

  it("lists only top-level businesses", () => {
    const opts = buildBusinessSaleOptions(accounts, liabilities, nameOf);
    expect(opts.map((b) => b.id)).toEqual(["biz1"]);
  });

  it("carries every child account the cascade will sell — default cash included", () => {
    const [biz] = buildBusinessSaleOptions(accounts, liabilities, nameOf);
    expect(biz.childAccounts.map((a) => a.id).sort()).toEqual(
      ["bizcash", "bizprop", "childbiz"].sort(),
    );
  });

  it("carries the child liabilities the cascade will settle", () => {
    const [biz] = buildBusinessSaleOptions(accounts, liabilities, nameOf);
    expect(biz.childLiabilities.map((l) => l.id)).toEqual(["l1"]);
  });

  it("resolves family-member owner names", () => {
    const [biz] = buildBusinessSaleOptions(accounts, liabilities, nameOf);
    expect(biz.owners).toEqual([
      { familyMemberId: "fm1", familyMemberName: "Dana Ray", percent: 0.6 },
      { familyMemberId: "fm2", familyMemberName: "Sam Ray", percent: 0.4 },
    ]);
  });

  it("labels the business type", () => {
    const [biz] = buildBusinessSaleOptions(accounts, liabilities, nameOf);
    expect(biz.businessTypeLabel).toBe("LLC");
  });

  it("keeps the operating value and basis separate from the children", () => {
    const [biz] = buildBusinessSaleOptions(accounts, liabilities, nameOf);
    expect(biz.value).toBe(1_000_000);
    expect(biz.basis).toBe(250_000);
  });
});

// ── totals ──────────────────────────────────────────────────────────────────

describe("business totals", () => {
  const biz = {
    id: "biz1", name: "Friends Inc.", businessTypeLabel: "LLC",
    value: 1_000_000, basis: 250_000, owners: [],
    childAccounts: [
      { id: "bizcash", name: "Cash", currentValue: 50_000 },
      { id: "bizprop", name: "Warehouse", currentValue: 800_000 },
    ],
    childLiabilities: [{ id: "l1", name: "Mortgage", currentBalance: 400_000 }],
  };

  it("totals the operating value plus every account the business owns", () => {
    expect(businessTotalAssetValue(biz)).toBe(1_850_000);
  });

  it("totals the debt the cascade settles", () => {
    expect(businessTotalDebt(biz)).toBe(400_000);
  });
});

// ── settlementAccounts ──────────────────────────────────────────────────────

describe("settlementAccounts", () => {
  const rows: SellSourceAccount[] = [
    { id: "chk", name: "Joint Checking", category: "cash", subType: "checking" },
    { id: "brk", name: "Brokerage", category: "taxable", subType: "brokerage", value: 500_000 },
    { id: "ira", name: "Rollover IRA", category: "retirement", subType: "traditional_ira" },
    { id: "home", name: "45 Oak Ave", category: "real_estate", subType: "primary_residence" },
    { id: "biz1", name: "Friends Inc.", category: "business", subType: "llc", value: 1_000_000 },
    { id: "bizcash", name: "Friends Inc. — Cash", category: "cash", subType: "checking",
      isDefaultChecking: true, parentAccountId: "biz1" },
    { id: "trustcash", name: "Trust — Cash", category: "cash", subType: "checking",
      isDefaultChecking: true, isEntityOwned: true },
  ];

  it("keeps household cash and taxable — the pick must work as source AND destination", () => {
    expect(settlementAccounts(rows).map((a) => a.id)).toEqual(["chk", "brk"]);
  });

  it("drops retirement: the purchase path debits a balance without recognizing income", () => {
    expect(settlementAccounts(rows).map((a) => a.id)).not.toContain("ira");
  });

  it("drops an entity's own operating cash — that plumbing is not the household's", () => {
    const ids = settlementAccounts(rows).map((a) => a.id);
    expect(ids).not.toContain("bizcash");
    expect(ids).not.toContain("trustcash");
  });
});
