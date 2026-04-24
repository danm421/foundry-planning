import { describe, it, expect } from "vitest";
import { validateBeneficiarySplit, type DesignationInput } from "../validate-split";

const fm = (id: string): Pick<DesignationInput, "familyMemberId"> => ({ familyMemberId: id });

describe("validateBeneficiarySplit", () => {
  it("accepts an empty list", () => {
    expect(validateBeneficiarySplit([])).toEqual({ ok: true });
  });

  it("accepts a single primary summing to 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 100, ...fm("a") },
    ]);
    expect(r).toEqual({ ok: true });
  });

  it("accepts two primaries that sum to 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 60, ...fm("a") },
      { tier: "primary", percentage: 40, ...fm("b") },
    ]);
    expect(r).toEqual({ ok: true });
  });

  it("accepts primaries summing to 100 without any contingents", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 100, ...fm("a") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("accepts contingents summing to 100 without any primaries", () => {
    const r = validateBeneficiarySplit([
      { tier: "contingent", percentage: 100, ...fm("a") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("accepts 0.01 tolerance on sums", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 33.33, ...fm("a") },
      { tier: "primary", percentage: 33.33, ...fm("b") },
      { tier: "primary", percentage: 33.34, ...fm("c") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects a primary tier that does not sum to 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 50, ...fm("a") },
      { tier: "primary", percentage: 40, ...fm("b") },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/primary.*100/i);
  });

  it("rejects a percentage of 0 or less", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 0, ...fm("a") },
      { tier: "primary", percentage: 100, ...fm("b") },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a percentage greater than 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 120, ...fm("a") },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate beneficiary within a tier", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 50, ...fm("a") },
      { tier: "primary", percentage: 50, ...fm("a") },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate/i);
  });

  it("allows same beneficiary in both primary and contingent tiers", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 100, ...fm("a") },
      { tier: "contingent", percentage: 100, ...fm("a") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("treats external beneficiary id as distinct key space from family member id", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 50, familyMemberId: "x" },
      { tier: "primary", percentage: 50, externalBeneficiaryId: "x" },
    ]);
    expect(r.ok).toBe(true);
  });
});
