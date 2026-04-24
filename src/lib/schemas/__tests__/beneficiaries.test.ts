import { describe, it, expect } from "vitest";
import {
  externalBeneficiaryCreateSchema,
  beneficiaryDesignationSchema,
  beneficiarySetSchema,
} from "../beneficiaries";

describe("externalBeneficiaryCreateSchema", () => {
  it("accepts a minimal charity", () => {
    const r = externalBeneficiaryCreateSchema.safeParse({
      name: "Stanford University",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const r = externalBeneficiaryCreateSchema.safeParse({ name: "" });
    expect(r.success).toBe(false);
  });
});

describe("beneficiaryDesignationSchema", () => {
  it("accepts a family-member primary", () => {
    const r = beneficiaryDesignationSchema.safeParse({
      tier: "primary",
      percentage: 100,
      familyMemberId: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
  });

  it("rejects both family and external ids set", () => {
    const r = beneficiaryDesignationSchema.safeParse({
      tier: "primary",
      percentage: 100,
      familyMemberId: "11111111-1111-1111-1111-111111111111",
      externalBeneficiaryId: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.success).toBe(false);
  });

  it("rejects neither id set", () => {
    const r = beneficiaryDesignationSchema.safeParse({
      tier: "primary",
      percentage: 100,
    });
    expect(r.success).toBe(false);
  });
});

describe("beneficiarySetSchema", () => {
  const fm = "11111111-1111-1111-1111-111111111111";
  const fm2 = "22222222-2222-2222-2222-222222222222";

  it("accepts an empty set", () => {
    const r = beneficiarySetSchema.safeParse([]);
    expect(r.success).toBe(true);
  });

  it("accepts a valid split", () => {
    const r = beneficiarySetSchema.safeParse([
      { tier: "primary", percentage: 60, familyMemberId: fm },
      { tier: "primary", percentage: 40, familyMemberId: fm2 },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects a set that does not sum to 100", () => {
    const r = beneficiarySetSchema.safeParse([
      { tier: "primary", percentage: 90, familyMemberId: fm },
    ]);
    expect(r.success).toBe(false);
  });
});
