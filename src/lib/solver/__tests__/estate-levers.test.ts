import { describe, it, expect } from "vitest";
import type { Account } from "@/engine/types";
import { isRevocableTagEligible, buildRevocableTagMutations } from "../estate-levers";

function acct(
  id: string,
  category: Account["category"],
  over: Partial<Account> = {},
): Account {
  return {
    id,
    name: id,
    category,
    value: 100_000,
    basis: 100_000,
    revocableTrustName: null,
    owners: [],
    ...over,
  } as unknown as Account;
}

describe("isRevocableTagEligible", () => {
  it("accepts probate-eligible, untagged categories", () => {
    expect(isRevocableTagEligible(acct("a", "taxable"))).toBe(true);
    expect(isRevocableTagEligible(acct("b", "real_estate"))).toBe(true);
    expect(isRevocableTagEligible(acct("c", "cash"))).toBe(true);
    expect(isRevocableTagEligible(acct("d", "business"))).toBe(true);
    expect(isRevocableTagEligible(acct("e", "stock_options"))).toBe(true);
    expect(isRevocableTagEligible(acct("f", "notes_receivable"))).toBe(true);
  });

  it("rejects beneficiary-by-nature categories", () => {
    expect(isRevocableTagEligible(acct("g", "retirement"))).toBe(false);
    expect(isRevocableTagEligible(acct("h", "annuity"))).toBe(false);
    expect(isRevocableTagEligible(acct("i", "life_insurance"))).toBe(false);
  });

  it("rejects accounts already tagged into a revocable trust", () => {
    expect(
      isRevocableTagEligible(acct("j", "taxable", { revocableTrustName: "Old Trust" })),
    ).toBe(false);
  });
});

describe("buildRevocableTagMutations", () => {
  const accounts = [
    acct("a", "taxable"),
    acct("b", "cash"),
    acct("r", "retirement"),
  ];

  it("tags selected eligible accounts with the trust name", () => {
    const muts = buildRevocableTagMutations(accounts, new Set(["a"]), "Smith Family Trust");
    const a = muts.find((m) => m.id === "a");
    expect(a).toMatchObject({
      kind: "account-upsert",
      id: "a",
      value: { revocableTrustName: "Smith Family Trust" },
    });
  });

  it("emits a null-clearing upsert for eligible-but-unselected accounts (so un-tagging reverts)", () => {
    const muts = buildRevocableTagMutations(accounts, new Set(["a"]), "Smith Family Trust");
    const b = muts.find((m) => m.id === "b");
    expect(b).toMatchObject({ kind: "account-upsert", id: "b", value: { revocableTrustName: null } });
  });

  it("never touches ineligible accounts", () => {
    const muts = buildRevocableTagMutations(accounts, new Set(["a"]), "Smith Family Trust");
    expect(muts.find((m) => m.id === "r")).toBeUndefined();
  });

  it("does not touch pre-existing base-tagged accounts that are not in the selection", () => {
    const preTagged = [
      acct("x", "taxable", { revocableTrustName: "Other Trust" }),
      acct("y", "cash"),
    ];
    const muts = buildRevocableTagMutations(preTagged, new Set(["y"]), "Smith Family Trust");
    // "x" has a different trust name and is not in selection → leave alone
    expect(muts.find((m) => m.id === "x")).toBeUndefined();
    // "y" is selected → tagged
    expect(muts.find((m) => m.id === "y")).toMatchObject({
      kind: "account-upsert",
      id: "y",
      value: { revocableTrustName: "Smith Family Trust" },
    });
  });
});
