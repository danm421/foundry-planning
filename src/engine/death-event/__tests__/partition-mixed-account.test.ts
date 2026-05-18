import { describe, it, expect } from "vitest";
import { partitionMixedAccount } from "../shared";
import type { Account } from "../../types";

const savings: Account = {
  id: "aSav", name: "Savings", category: "cash", value: 0, basis: 0,
  owners: [
    { kind: "family_member", familyMemberId: "fmCooper", percent: 0.8 },
    { kind: "entity", entityId: "e1", percent: 0.2 },
  ],
} as Account;

describe("partitionMixedAccount", () => {
  it("peels the entity slice and renormalizes the family pool", () => {
    const r = partitionMixedAccount(savings, 100_000, 40_000, undefined);
    expect(r.entitySlices).toHaveLength(1);
    expect(r.entitySlices[0].value).toBe(20_000);
    expect(r.entitySlices[0].basis).toBe(8_000);
    expect(r.entitySlices[0].owners).toEqual([{ kind: "entity", entityId: "e1", percent: 1 }]);
    expect(r.entitySlices[0].id).not.toBe("aSav"); // synthetic id

    expect(r.familyPool.id).toBe("aSav"); // family pool keeps original id
    expect(r.familyPool.value).toBe(80_000);
    expect(r.familyPool.basis).toBe(32_000);
    expect(r.familyPool.owners).toEqual([
      { kind: "family_member", familyMemberId: "fmCooper", percent: 1 },
    ]);
  });

  it("prefers locked entity share when supplied", () => {
    const locked = new Map([["e1", new Map([["aSav", 25_000]])]]);
    const r = partitionMixedAccount(savings, 100_000, 40_000, locked);
    expect(r.entitySlices[0].value).toBe(25_000);
    expect(r.familyPool.value).toBe(75_000);
    // Basis fraction tracks locked value (25k/100k = 25%), not the nominal 20% percent.
    // Entity slice basis = 40_000 × 0.25 = 10_000; family pool basis = 30_000.
    expect(r.entitySlices[0].basis).toBeCloseTo(10_000, 0);
    expect(r.familyPool.basis).toBeCloseTo(30_000, 0);
  });
});
