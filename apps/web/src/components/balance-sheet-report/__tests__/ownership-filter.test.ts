import { describe, it, expect } from "vitest";
import { filterAccounts, filterLiabilities, type OwnershipView } from "../ownership-filter";

type Acc = { id: string; owner: "client" | "spouse" | "joint"; ownerEntityId?: string };
type Liab = { id: string; owner?: "client" | "spouse" | "joint"; ownerEntityId?: string };

const accounts: Acc[] = [
  { id: "a1", owner: "client" },
  { id: "a2", owner: "spouse" },
  { id: "a3", owner: "joint" },
  { id: "a4", owner: "client", ownerEntityId: "e1" },   // trust owned by client
  { id: "a5", owner: "joint", ownerEntityId: "e2" },    // LLC owned jointly
];

const liabilities: Liab[] = [
  { id: "l1", owner: "client" },
  { id: "l2", owner: "joint" },
  { id: "l3", owner: "spouse", ownerEntityId: "e1" },   // entity-owned liability
];

describe("filterAccounts", () => {
  const cases: Array<[OwnershipView, string[]]> = [
    ["consolidated", ["a1", "a2", "a3", "a4", "a5"]],
    ["client", ["a1"]],
    ["spouse", ["a2"]],
    ["joint", ["a3"]],
    ["entities", ["a4", "a5"]],
  ];

  for (const [view, expectedIds] of cases) {
    it(`returns the correct rows for view=${view}`, () => {
      const result = filterAccounts(accounts, view).map((a) => a.id);
      expect(result).toEqual(expectedIds);
    });
  }

  it("never leaks entity-owned rows into client/spouse/joint filters", () => {
    expect(filterAccounts(accounts, "client").some((a) => a.ownerEntityId)).toBe(false);
    expect(filterAccounts(accounts, "spouse").some((a) => a.ownerEntityId)).toBe(false);
    expect(filterAccounts(accounts, "joint").some((a) => a.ownerEntityId)).toBe(false);
  });
});

describe("filterLiabilities", () => {
  it("applies the same predicate shape as accounts", () => {
    expect(filterLiabilities(liabilities, "client").map((l) => l.id)).toEqual(["l1"]);
    expect(filterLiabilities(liabilities, "entities").map((l) => l.id)).toEqual(["l3"]);
    expect(filterLiabilities(liabilities, "consolidated").map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("treats liabilities without an owner field as personal (fall through)", () => {
    const orphan: Liab = { id: "lx" };
    const result = filterLiabilities([orphan, ...liabilities], "consolidated");
    expect(result.map((l) => l.id)).toContain("lx");
    expect(filterLiabilities([orphan], "entities")).toEqual([]);
  });
});
