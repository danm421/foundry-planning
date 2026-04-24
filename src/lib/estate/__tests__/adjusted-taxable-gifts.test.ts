import { describe, it, expect } from "vitest";
import { computeAdjustedTaxableGifts } from "../adjusted-taxable-gifts";
import type { Gift, EntitySummary } from "@/engine/types";

const ann = { 2025: 19_000, 2026: 19_000, 2027: 19_500 };

function gift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: "g1",
    year: 2025,
    amount: 100_000,
    grantor: "client",
    useCrummeyPowers: false,
    ...overrides,
  };
}

function entity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: "e1",
    includeInPortfolio: true,
    isGrantor: true,
    exemptionConsumed: 0,
    ...overrides,
  };
}

describe("computeAdjustedTaxableGifts", () => {
  it("returns 0 when decedent has no gifts and no grantor-trusts", () => {
    expect(computeAdjustedTaxableGifts("client", [], [], ann)).toBe(0);
  });

  it("subtracts the annual exclusion per gift, floored at zero", () => {
    const gifts = [
      gift({ year: 2025, amount: 100_000 }),
      gift({ year: 2025, amount: 15_000 }),
      gift({ year: 2027, amount: 30_000 }),
    ];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann)).toBeCloseTo(81_000 + 10_500, 2);
  });

  it("excludes spouse-grantor gifts when decedent is client", () => {
    const gifts = [
      gift({ grantor: "client", amount: 100_000 }),
      gift({ grantor: "spouse", amount: 100_000 }),
    ];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann)).toBeCloseTo(81_000, 2);
  });

  it("splits joint gifts 50/50", () => {
    const gifts = [gift({ grantor: "joint", amount: 100_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann)).toBeCloseTo(31_000, 2);
    expect(computeAdjustedTaxableGifts("spouse", gifts, [], ann)).toBeCloseTo(31_000, 2);
  });

  it("adds trust exemptionConsumed when entity.grantor === decedent", () => {
    const entities = [entity({ grantor: "client", exemptionConsumed: 2_400_000 })];
    expect(computeAdjustedTaxableGifts("client", [], entities, ann)).toBeCloseTo(2_400_000, 2);
    expect(computeAdjustedTaxableGifts("spouse", [], entities, ann)).toBe(0);
  });

  it("third-party-grantor trust (entity.grantor === undefined) contributes 0", () => {
    const entities = [entity({ grantor: undefined, exemptionConsumed: 2_400_000 })];
    expect(computeAdjustedTaxableGifts("client", [], entities, ann)).toBe(0);
  });

  it("combined: gifts + trust exemption stacks for the same grantor", () => {
    const gifts = [gift({ year: 2025, amount: 100_000, grantor: "client" })];
    const entities = [entity({ grantor: "client", exemptionConsumed: 1_000_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, entities, ann)).toBeCloseTo(81_000 + 1_000_000, 2);
  });

  it("missing annual exclusion for a year defaults to 0 (no subtraction)", () => {
    const gifts = [gift({ year: 2099, amount: 50_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann)).toBeCloseTo(50_000, 2);
  });
});
