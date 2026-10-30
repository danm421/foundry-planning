import { describe, it, expect } from "vitest";
import {
  DEFAULT_WITHDRAWAL_GROUP_ORDER,
  describeWithdrawalPolicy,
  parseWithdrawalPolicy,
  resolveWithdrawalPolicy,
  withdrawalGroupOf,
  withdrawalPolicyProblem,
} from "../withdrawal-policy";
import type { Account } from "../types";

const acct = (overrides: Partial<Account>): Account => ({
  id: "a", name: "a", category: "cash", subType: "savings", titlingType: "jtwros",
  value: 0, basis: 0, growthRate: 0, rmdEnabled: false, owners: [],
  ...overrides,
});

describe("withdrawalGroupOf", () => {
  it("puts each spendable category in the group the engine has always drawn it in", () => {
    expect(withdrawalGroupOf(acct({ category: "cash" }))).toBe("cash");
    expect(withdrawalGroupOf(acct({ category: "taxable", subType: "brokerage" }))).toBe("taxable");
    expect(withdrawalGroupOf(acct({ category: "retirement", subType: "traditional_ira" }))).toBe("tax_deferred");
    expect(withdrawalGroupOf(acct({ category: "retirement", subType: "401k" }))).toBe("tax_deferred");
    expect(withdrawalGroupOf(acct({ category: "retirement", subType: "hsa" }))).toBe("tax_deferred");
    expect(withdrawalGroupOf(acct({ category: "retirement", subType: "roth_ira" }))).toBe("roth");
    expect(withdrawalGroupOf(acct({ category: "annuity", subType: "myga" }))).toBe("annuity");
  });

  it("never draws an annuitized contract or an illiquid asset", () => {
    expect(
      withdrawalGroupOf(acct({ category: "annuity", annuity: { incomeMode: "annuitized" } as Account["annuity"] })),
    ).toBeNull();
    for (const category of ["real_estate", "business", "life_insurance", "notes_receivable", "stock_options"]) {
      expect(withdrawalGroupOf(acct({ category: category as Account["category"] }))).toBeNull();
    }
  });
});

describe("parseWithdrawalPolicy", () => {
  it("returns null for anything that is not a policy", () => {
    expect(parseWithdrawalPolicy(null)).toBeNull();
    expect(parseWithdrawalPolicy("order")).toBeNull();
    expect(parseWithdrawalPolicy({ method: "bracket_fill" })).toBeNull();
  });

  it("repairs the group order: drops unknown and repeated groups, appends missing ones", () => {
    const p = parseWithdrawalPolicy({ method: "order", groupOrder: ["roth", "bogus", "roth", "cash"] });
    expect(p?.groupOrder).toEqual(["roth", "cash", "taxable", "tax_deferred", "annuity"]);
    expect(p?.excludedAccountIds).toEqual([]);
  });

  it("keeps only valid split shares and excluded ids", () => {
    const p = parseWithdrawalPolicy({
      method: "split",
      groupOrder: DEFAULT_WITHDRAWAL_GROUP_ORDER,
      splitPct: { taxable: 0.6, tax_deferred: 0.4, roth: "x", nope: 1 },
      excludedAccountIds: ["a1", 7, "a1", "a2"],
    });
    expect(p?.splitPct).toEqual({ taxable: 0.6, tax_deferred: 0.4 });
    expect(p?.excludedAccountIds).toEqual(["a1", "a2"]);
  });
});

describe("withdrawalPolicyProblem", () => {
  const base = { method: "split", groupOrder: DEFAULT_WITHDRAWAL_GROUP_ORDER, excludedAccountIds: [] };

  it("accepts a split that totals 100%", () => {
    expect(withdrawalPolicyProblem({ ...base, splitPct: { taxable: 0.6, tax_deferred: 0.4 } })).toBeNull();
  });

  it("refuses a split that does not total 100%", () => {
    expect(withdrawalPolicyProblem({ ...base, splitPct: { taxable: 0.6, tax_deferred: 0.3 } })).toMatch(/100%/);
  });

  it("refuses a share outside 0–100%", () => {
    expect(withdrawalPolicyProblem({ ...base, splitPct: { taxable: 1.2, tax_deferred: -0.2 } })).toMatch(/between 0% and 100%/);
  });

  it("refuses an unknown method, group or excluded id", () => {
    expect(withdrawalPolicyProblem({ ...base, method: "bracket_fill" })).not.toBeNull();
    expect(withdrawalPolicyProblem({ ...base, method: "order", groupOrder: ["cash", "gold"] })).not.toBeNull();
    expect(withdrawalPolicyProblem({ ...base, method: "order", excludedAccountIds: [""] })).not.toBeNull();
  });

  it("accepts null (back to the default)", () => {
    expect(withdrawalPolicyProblem(null)).toBeNull();
  });
});

describe("resolveWithdrawalPolicy", () => {
  it("with nothing saved, runs today's behaviour: the account list if there is one, else the default order", () => {
    expect(resolveWithdrawalPolicy(null, false)).toEqual({
      method: "order", groupOrder: [...DEFAULT_WITHDRAWAL_GROUP_ORDER], excludedAccountIds: [],
    });
    expect(resolveWithdrawalPolicy(undefined, true).method).toBe("custom");
  });

  it("Account by account with an empty list falls back to In order, keeping the saved order and exclusions", () => {
    const saved = parseWithdrawalPolicy({
      method: "custom", groupOrder: ["roth", "cash", "taxable", "tax_deferred", "annuity"], excludedAccountIds: ["x"],
    });
    const p = resolveWithdrawalPolicy(saved, false);
    expect(p.method).toBe("order");
    expect(p.groupOrder[0]).toBe("roth");
    expect(p.excludedAccountIds).toEqual(["x"]);
  });

  it("a split whose shares are all zero runs as In order", () => {
    const saved = parseWithdrawalPolicy({ method: "split", splitPct: {} });
    expect(resolveWithdrawalPolicy(saved, false).method).toBe("order");
  });
});

describe("describeWithdrawalPolicy", () => {
  it("reads each method in plain words", () => {
    expect(describeWithdrawalPolicy(resolveWithdrawalPolicy(null, false))).toBe(
      "In order: Cash & savings → Taxable → Tax-deferred → Roth → Annuities",
    );
    expect(
      describeWithdrawalPolicy(parseWithdrawalPolicy({
        method: "split", splitPct: { taxable: 0.6, tax_deferred: 0.4 }, excludedAccountIds: ["a", "b"],
      })!),
    ).toBe("Split: 60% Taxable, 40% Tax-deferred · 2 accounts never sold");
    expect(describeWithdrawalPolicy(parseWithdrawalPolicy({ method: "proportional", excludedAccountIds: ["a"] })!)).toBe(
      "Proportional to each account's balance · 1 account never sold",
    );
    expect(describeWithdrawalPolicy(parseWithdrawalPolicy({ method: "custom" })!)).toBe("Account by account");
  });
});
