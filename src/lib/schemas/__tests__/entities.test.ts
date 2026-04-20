import { describe, it, expect } from "vitest";
import {
  entityCreateSchema,
  entityUpdateSchema,
} from "../entities";

describe("entityCreateSchema — non-trust", () => {
  it("accepts an LLC without trust fields", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      value: "250000",
      owner: "joint",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an LLC with a trust sub-type", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      trustSubType: "slat",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an LLC with isIrrevocable set", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      isIrrevocable: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an LLC with non-zero exemption consumed", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      exemptionConsumed: 1000,
    });
    expect(r.success).toBe(false);
  });
});

describe("entityCreateSchema — trust", () => {
  it("accepts a trust with consistent sub-type and irrevocability", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith SLAT",
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: true,
      trustee: "Linda",
      exemptionConsumed: 2400000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a revocable trust with isIrrevocable=false", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith Rev Trust",
      entityType: "trust",
      trustSubType: "revocable",
      isIrrevocable: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a trust with inconsistent sub-type + irrevocable", () => {
    const r = entityCreateSchema.safeParse({
      name: "Bad SLAT",
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a trust missing trustSubType", () => {
    const r = entityCreateSchema.safeParse({
      name: "No Sub",
      entityType: "trust",
      isIrrevocable: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a trust missing isIrrevocable", () => {
    const r = entityCreateSchema.safeParse({
      name: "No Flag",
      entityType: "trust",
      trustSubType: "slat",
    });
    expect(r.success).toBe(false);
  });
});

describe("entityUpdateSchema", () => {
  it("accepts a partial update to trustee only", () => {
    const r = entityUpdateSchema.safeParse({ trustee: "New Name" });
    expect(r.success).toBe(true);
  });

  it("accepts a partial update setting exemptionConsumed only", () => {
    const r = entityUpdateSchema.safeParse({ exemptionConsumed: 1500000 });
    expect(r.success).toBe(true);
  });

  it("rejects a partial update with inconsistent trustSubType + isIrrevocable pair", () => {
    const r = entityUpdateSchema.safeParse({
      trustSubType: "slat",
      isIrrevocable: false,
    });
    expect(r.success).toBe(false);
  });
});
