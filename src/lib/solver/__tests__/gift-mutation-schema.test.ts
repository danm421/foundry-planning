import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";

describe("SOLVER_MUTATION_SCHEMA — gift-upsert", () => {
  it("accepts a cash-once gift", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "gift-upsert", id: "g1",
      value: { kind: "cash-once", id: "g1", year: 2030, amount: 50000, grantor: "client", recipient: { kind: "external_beneficiary", id: "c1" }, crummey: false },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a series gift to a trust", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "gift-upsert", id: "g2",
      value: { kind: "series", id: "g2", startYear: 2030, endYear: 2040, annualAmount: 18000, amountMode: "annual_exclusion", inflationAdjust: true, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: true },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an asset-once gift", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "gift-upsert", id: "g3",
      value: { kind: "asset-once", id: "g3", year: 2031, accountId: "acct-1", percent: 0.5, grantor: "client", recipient: { kind: "entity", id: "t1" }, amountOverride: 250000, eventKind: "outright" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an asset-once gift with percent > 1", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "gift-upsert", id: "g3",
      value: { kind: "asset-once", id: "g3", year: 2031, accountId: "acct-1", percent: 50, grantor: "client", recipient: { kind: "entity", id: "t1" } },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a delete (value:null)", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({ kind: "gift-upsert", id: "g1", value: null });
    expect(r.success).toBe(true);
  });

  // A discount is stripped rather than rejected when the schema omits the key —
  // `success: true` alone cannot catch that, so these read the parsed VALUE.
  it("preserves valuationDiscount on an asset-once gift", () => {
    const r = SOLVER_MUTATION_SCHEMA.parse({
      kind: "gift-upsert", id: "g3",
      value: { kind: "asset-once", id: "g3", year: 2031, accountId: "acct-1", percent: 0.15, grantor: "client", recipient: { kind: "entity", id: "t1" }, valuationDiscount: 0.3 },
    });
    expect(r).toMatchObject({ value: { valuationDiscount: 0.3 } });
  });

  it("preserves valuationDiscount on a cash-once gift", () => {
    const r = SOLVER_MUTATION_SCHEMA.parse({
      kind: "gift-upsert", id: "g1",
      value: { kind: "cash-once", id: "g1", year: 2030, amount: 50000, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false, valuationDiscount: 0.25 },
    });
    expect(r).toMatchObject({ value: { valuationDiscount: 0.25 } });
  });

  it("preserves valuationDiscount on a series gift", () => {
    const r = SOLVER_MUTATION_SCHEMA.parse({
      kind: "gift-upsert", id: "g2",
      value: { kind: "series", id: "g2", startYear: 2030, endYear: 2040, annualAmount: 18000, amountMode: "fixed", inflationAdjust: false, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: true, valuationDiscount: 0.4 },
    });
    expect(r).toMatchObject({ value: { valuationDiscount: 0.4 } });
  });

  it("rejects a valuationDiscount of 1 or more", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "gift-upsert", id: "g3",
      value: { kind: "asset-once", id: "g3", year: 2031, accountId: "acct-1", percent: 0.15, grantor: "client", recipient: { kind: "entity", id: "t1" }, valuationDiscount: 1 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a bad recipient kind", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "gift-upsert", id: "g1",
      value: { kind: "cash-once", id: "g1", year: 2030, amount: 50000, grantor: "client", recipient: { kind: "bogus", id: "c1" }, crummey: false },
    });
    expect(r.success).toBe(false);
  });
});

describe("SOLVER_MUTATION_SCHEMA — external-beneficiary-upsert", () => {
  it("accepts a charity", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "external-beneficiary-upsert", id: "c1",
      value: { id: "c1", name: "Red Cross", kind: "charity", charityType: "public" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a bad charityType", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "external-beneficiary-upsert", id: "c1",
      value: { id: "c1", name: "Red Cross", kind: "charity", charityType: "donor_advised" },
    });
    expect(r.success).toBe(false);
  });
});
