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

  it("rejects an LLC with a distribution policy", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      distributionMode: "fixed",
      distributionAmount: 50_000,
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

describe("entityCreateSchema — trustEnds field", () => {
  const baseTrust = {
    name: "Smith SLAT",
    entityType: "trust",
    trustSubType: "slat",
    isIrrevocable: true,
  };

  it('accepts trustEnds = "client_death"', () => {
    const r = entityCreateSchema.safeParse({ ...baseTrust, trustEnds: "client_death" });
    expect(r.success).toBe(true);
  });

  it('accepts trustEnds = "spouse_death"', () => {
    const r = entityCreateSchema.safeParse({ ...baseTrust, trustEnds: "spouse_death" });
    expect(r.success).toBe(true);
  });

  it('accepts trustEnds = "survivorship"', () => {
    const r = entityCreateSchema.safeParse({ ...baseTrust, trustEnds: "survivorship" });
    expect(r.success).toBe(true);
  });

  it("accepts trustEnds = null", () => {
    const r = entityCreateSchema.safeParse({ ...baseTrust, trustEnds: null });
    expect(r.success).toBe(true);
  });

  it("accepts trustEnds omitted (undefined)", () => {
    const r = entityCreateSchema.safeParse({ ...baseTrust });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid trustEnds value", () => {
    const r = entityCreateSchema.safeParse({ ...baseTrust, trustEnds: "never" });
    expect(r.success).toBe(false);
  });
});

describe("entityCreateSchema — distribution policy", () => {
  it("accepts valid fixed distribution without beneficiary fields (designations are a separate request)", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "fixed", distributionAmount: 50_000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects fixed mode without amount", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "fixed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects pct_income mode with amount but no percent", () => {
    const result = entityCreateSchema.safeParse({
      name: "SLAT", entityType: "trust", trustSubType: "slat", isIrrevocable: true,
      distributionMode: "pct_income", distributionAmount: 50_000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects distribution on revocable trust", () => {
    const result = entityCreateSchema.safeParse({
      name: "Revocable", entityType: "trust", trustSubType: "revocable", isIrrevocable: false,
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

  it("accepts a partial update setting trustEnds only", () => {
    const r = entityUpdateSchema.safeParse({ trustEnds: "survivorship" });
    expect(r.success).toBe(true);
  });

  it("accepts a partial update setting trustEnds to null", () => {
    const r = entityUpdateSchema.safeParse({ trustEnds: null });
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
    });
    expect(r.success).toBe(false);
  });

  // Dropped fields are silently stripped (schema uses z.object() without
  // .strict()), matching the existing codebase convention.
  it("silently strips dropped fields (exemptionConsumed, incomeBeneficiaryFamilyMemberId, incomeBeneficiaryExternalId)", () => {
    const r = entityUpdateSchema.safeParse({
      trustee: "Alice",
      exemptionConsumed: 1_000_000,
      incomeBeneficiaryFamilyMemberId: "00000000-0000-4000-8000-000000000001",
      incomeBeneficiaryExternalId: "00000000-0000-4000-8000-000000000002",
    });
    // Parse succeeds; unknown keys are stripped by Zod's default behavior.
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("exemptionConsumed");
      expect(r.data).not.toHaveProperty("incomeBeneficiaryFamilyMemberId");
      expect(r.data).not.toHaveProperty("incomeBeneficiaryExternalId");
    }
  });
});

describe("entityCreateSchema — Phase 1 flow fields", () => {
  it("accepts taxTreatment + distributionPolicyPercent on create", () => {
    const r = entityCreateSchema.safeParse({
      name: "Acme",
      entityType: "llc",
      taxTreatment: "qbi",
      distributionPolicyPercent: 0.5,
    });
    expect(r.success).toBe(true);
  });

  it("rejects taxTreatment outside the enum", () => {
    const r = entityCreateSchema.safeParse({
      name: "Acme",
      entityType: "llc",
      taxTreatment: "garbage",
    });
    expect(r.success).toBe(false);
  });

  it("rejects distributionPolicyPercent > 1", () => {
    const r = entityCreateSchema.safeParse({
      name: "Acme",
      entityType: "llc",
      distributionPolicyPercent: 1.5,
    });
    expect(r.success).toBe(false);
  });
});

describe("entityUpdateSchema — Phase 1 flow fields", () => {
  it("allows nulling distributionPolicyPercent", () => {
    const r = entityUpdateSchema.safeParse({ distributionPolicyPercent: null });
    expect(r.success).toBe(true);
  });
});
