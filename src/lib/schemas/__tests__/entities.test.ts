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

  it("rejects an LLC with a distribution policy", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      distributionMode: "fixed",
      distributionAmount: 50_000,
      incomeBeneficiaryFamilyMemberId: FM_UUID,
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

const FM_UUID = "00000000-0000-4000-8000-000000000001";
const EXT_UUID = "00000000-0000-4000-8000-000000000002";

describe("entityCreateSchema — distribution policy", () => {
  it("accepts valid fixed distribution with family-member beneficiary", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "fixed", distributionAmount: 50_000,
      incomeBeneficiaryFamilyMemberId: FM_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects XOR violation (both beneficiaries set)", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "fixed", distributionAmount: 50_000,
      incomeBeneficiaryFamilyMemberId: FM_UUID,
      incomeBeneficiaryExternalId: EXT_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects fixed mode without amount", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "fixed",
      incomeBeneficiaryFamilyMemberId: FM_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects pct_income mode with amount but no percent", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "pct_income", distributionAmount: 50_000,
      incomeBeneficiaryFamilyMemberId: FM_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects distribution on revocable trust", () => {
    const result = entityCreateSchema.safeParse({
      name: "Revocable", entityType: "trust", trustSubType: "revocable", isIrrevocable: false,
      distributionMode: "fixed", distributionAmount: 50_000,
      incomeBeneficiaryFamilyMemberId: FM_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects distribution mode set without beneficiary", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "fixed", distributionAmount: 50_000,
    });
    expect(result.success).toBe(false);
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

  it("rejects PATCH with distributionMode fixed but no amount", () => {
    const r = entityUpdateSchema.safeParse({
      distributionMode: "fixed",
      incomeBeneficiaryFamilyMemberId: FM_UUID,
    });
    expect(r.success).toBe(false);
  });

  it("rejects PATCH with distributionMode and both beneficiaries set", () => {
    const r = entityUpdateSchema.safeParse({
      distributionMode: "fixed",
      distributionAmount: 50_000,
      incomeBeneficiaryFamilyMemberId: FM_UUID,
      incomeBeneficiaryExternalId: EXT_UUID,
    });
    expect(r.success).toBe(false);
  });
});
