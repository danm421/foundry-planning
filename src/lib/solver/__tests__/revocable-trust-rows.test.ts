import { describe, it, expect } from "vitest";
import type { Account } from "@/engine/types";
import {
  revocableTrustRows,
  revocableEligibleAccounts,
  buildRevocableMembershipMutations,
  buildRevocableRenameMutations,
} from "../revocable-trust-rows";

function acct(
  id: string,
  category: Account["category"],
  revocableTrustName: string | null = null,
  owners: unknown[] = [],
): Account {
  return { id, name: id, category, value: 1, basis: 1, revocableTrustName, owners } as unknown as Account;
}

describe("revocableTrustRows", () => {
  it("lists each base revocable trust once", () => {
    const base = [acct("a", "taxable", "Smith RLT"), acct("b", "cash", "Smith RLT"), acct("c", "cash", "Jones RLT")];
    expect(revocableTrustRows(base, base)).toEqual([
      { name: "Jones RLT", isBase: true, accountIds: ["c"] },
      { name: "Smith RLT", isBase: true, accountIds: ["a", "b"] },
    ]);
  });

  it("still lists a base trust whose accounts were all unticked", () => {
    const base = [acct("a", "taxable", "Smith RLT")];
    const working = [acct("a", "taxable", null)];
    expect(revocableTrustRows(base, working)).toEqual([{ name: "Smith RLT", isBase: true, accountIds: [] }]);
  });

  it("lists an added name as not base, after base rows, and skips empty added names", () => {
    const base = [acct("a", "taxable", "Zed RLT"), acct("b", "cash")];
    const working = [acct("a", "taxable", "Zed RLT"), acct("b", "cash", " Alpha RLT ")];
    expect(revocableTrustRows(base, working)).toEqual([
      { name: "Zed RLT", isBase: true, accountIds: ["a"] },
      { name: "Alpha RLT", isBase: false, accountIds: ["b"] },
    ]);
    expect(revocableTrustRows([], [acct("a", "taxable", "  ")])).toEqual([]);
  });
});

describe("revocableEligibleAccounts", () => {
  const accts = [
    acct("free", "taxable"),
    acct("mine", "cash", "T"),
    acct("other", "cash", "U"),
    acct("ira", "retirement"),
    acct("ent", "taxable", null, [{ kind: "entity", entityId: "e1", percent: 1 }]),
    acct("gift", "taxable", null, [{ kind: "gifted_away", recipient: { kind: "entity", id: "e1" }, percent: 1 }]),
  ];
  it("excludes other trusts, ineligible categories and trust-held accounts", () => {
    expect(revocableEligibleAccounts(accts, "T").map((a) => a.id)).toEqual(["free", "mine"]);
    expect(revocableEligibleAccounts(accts, null).map((a) => a.id)).toEqual(["free"]);
  });
});

describe("buildRevocableMembershipMutations", () => {
  it("emits only accounts whose tag changes", () => {
    const accts = [acct("a", "taxable", "T"), acct("b", "cash", "T"), acct("c", "cash"), acct("d", "cash")];
    const muts = buildRevocableMembershipMutations(accts, "T", new Set(["a", "c"]));
    expect(muts).toEqual([
      { kind: "account-upsert", id: "b", value: { ...accts[1], revocableTrustName: null } },
      { kind: "account-upsert", id: "c", value: { ...accts[2], revocableTrustName: "T" } },
    ]);
  });
});

describe("buildRevocableRenameMutations", () => {
  it("retags accounts carrying the old name", () => {
    const accts = [acct("a", "taxable", "Old"), acct("b", "cash", "Other")];
    expect(buildRevocableRenameMutations(accts, "Old", "New")).toEqual([
      { kind: "account-upsert", id: "a", value: { ...accts[0], revocableTrustName: "New" } },
    ]);
  });
});
