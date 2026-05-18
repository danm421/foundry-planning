import { describe, it, expect } from "vitest";
import { businessConsolidatedValue } from "../business-value";
import type { Account, EntitySummary } from "../../types";

const llc: EntitySummary = {
  id: "e1", name: "Test Bus", entityType: "llc", value: 10_000,
  basis: 4_000, owners: [{ familyMemberId: "fmCooper", percent: 1 }],
} as EntitySummary;

const savings: Account = {
  id: "aSav", name: "Savings", category: "cash",
  owners: [
    { kind: "family_member", familyMemberId: "fmCooper", percent: 0.8 },
    { kind: "entity", entityId: "e1", percent: 0.2 },
  ],
} as Account;

const cash: Account = {
  id: "aCash", name: "Test Bus — Cash", category: "cash",
  owners: [{ kind: "entity", entityId: "e1", percent: 1 }],
} as Account;

describe("businessConsolidatedValue", () => {
  it("sums flat value + owned account slices (mixed + 100%)", () => {
    const v = businessConsolidatedValue(
      llc, [savings, cash], { aSav: 100_000, aCash: 0 }, undefined,
    );
    expect(v).toBe(30_000); // 10k flat + 20k slice + 0 cash
  });

  it("prefers locked entityAccountSharesEoY over balance × percent", () => {
    const locked = new Map([["e1", new Map([["aSav", 17_500]])]]);
    const v = businessConsolidatedValue(
      llc, [savings, cash], { aSav: 100_000, aCash: 0 }, locked,
    );
    expect(v).toBe(27_500); // 10k flat + 17.5k locked + 0 cash
  });

  it("treats locked zero as zero, not falling back to balance × percent", () => {
    const locked = new Map([["e1", new Map([["aSav", 0]])]]);
    const v = businessConsolidatedValue(
      llc, [savings, cash], { aSav: 100_000, aCash: 0 }, locked,
    );
    expect(v).toBe(10_000); // 10k flat + 0 locked (no fallback) + 0 cash
  });
});
