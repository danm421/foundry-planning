import { describe, it, expect } from "vitest";
import type { Account } from "../../types";
import { collectBusinessTree, consolidatedBusinessValue } from "../business-tree";

const baseAcct: Omit<Account, "id" | "category" | "value"> = {
  name: "x",
  subType: "other",
  basis: 0,
  owners: [],
  scenarioId: "s",
  clientId: "c",
} as unknown as Omit<Account, "id" | "category" | "value">;

describe("collectBusinessTree", () => {
  it("returns the parent plus all descendant accounts", () => {
    const parent: Account = { ...baseAcct, id: "biz", category: "business", value: 500_000 } as Account;
    const child: Account = {
      ...baseAcct,
      id: "cash",
      category: "cash",
      value: 50_000,
      parentAccountId: "biz",
    } as Account;
    const unrelated: Account = {
      ...baseAcct,
      id: "other",
      category: "taxable",
      value: 100_000,
    } as Account;

    const tree = collectBusinessTree("biz", [parent, child, unrelated]);
    expect(tree.map((a) => a.id).sort()).toEqual(["biz", "cash"]);
  });

  it("handles a grandchild (holdco -> subsidiary -> sub-account)", () => {
    const holdco: Account = { ...baseAcct, id: "holdco", category: "business", value: 1_000_000 } as Account;
    const sub: Account = {
      ...baseAcct,
      id: "sub",
      category: "business",
      value: 400_000,
      parentAccountId: "holdco",
    } as Account;
    const cash: Account = {
      ...baseAcct,
      id: "cash",
      category: "cash",
      value: 25_000,
      parentAccountId: "sub",
    } as Account;
    const tree = collectBusinessTree("holdco", [holdco, sub, cash]);
    expect(tree.map((a) => a.id).sort()).toEqual(["cash", "holdco", "sub"]);
  });
});

describe("consolidatedBusinessValue", () => {
  it("sums parent value + child balances, skipping drained accounts", () => {
    const parent: Account = { ...baseAcct, id: "biz", category: "business", value: 500_000 } as Account;
    const cash: Account = {
      ...baseAcct,
      id: "cash",
      category: "cash",
      value: 50_000,
      parentAccountId: "biz",
    } as Account;
    const drained: Account = {
      ...baseAcct,
      id: "drained",
      category: "taxable",
      value: 0,
      parentAccountId: "biz",
    } as Account;
    const balances = { biz: 500_000, cash: 50_000, drained: 0 };
    expect(consolidatedBusinessValue("biz", [parent, cash, drained], balances)).toBe(550_000);
  });
});
