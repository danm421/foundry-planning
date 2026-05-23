import { describe, it, expect } from "vitest";
import { businessConsolidatedValue } from "../business-value";
import type { Account } from "../../types";

// LLC modeled as a top-level business account. Value carried on the account
// itself; sub-accounts live as child accounts via parentAccountId.
const llcAccount: Account = {
  id: "biz-1",
  name: "Test Bus",
  category: "business",
  subType: "llc",
  value: 10_000,
  basis: 4_000,
  businessType: "llc",
  parentAccountId: null,
  growthRate: 0,
  rmdEnabled: false,
  titlingType: "jtwros",
  owners: [{ kind: "family_member", familyMemberId: "fmCooper", percent: 1 }],
} as Account;

// "Test Bus — Cash" — 100%-owned child of the LLC.
const cash: Account = {
  id: "aCash",
  name: "Test Bus — Cash",
  category: "cash",
  subType: "checking",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  titlingType: "jtwros",
  parentAccountId: "biz-1",
  owners: [],
} as Account;

describe("businessConsolidatedValue", () => {
  it("sums flat value + descendant balances", () => {
    // $10k flat (biz-1 own balance) + $20k cash child = $30k.
    const v = businessConsolidatedValue(
      llcAccount,
      [llcAccount, cash],
      { "biz-1": 10_000, aCash: 20_000 },
    );
    expect(v).toBe(30_000);
  });

  it("treats a zero-balance child as zero (no flat-value fallback)", () => {
    // $10k flat + $0 cash = $10k.
    const v = businessConsolidatedValue(
      llcAccount,
      [llcAccount, cash],
      { "biz-1": 10_000, aCash: 0 },
    );
    expect(v).toBe(10_000);
  });

  it("returns 0 when the business itself has no balance and no children", () => {
    const v = businessConsolidatedValue(llcAccount, [llcAccount], { "biz-1": 0 });
    expect(v).toBe(0);
  });
});
