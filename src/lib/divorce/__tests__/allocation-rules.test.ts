import { describe, it, expect } from "vitest";
import {
  defaultDisposition, allowedDispositions, isSplittable,
  validateAllocation, resolveAllocations, AllocationError,
  type DivisibleObject,
} from "../allocation-rules";

const base: DivisibleObject = {
  kind: "account", id: "a1", label: "Brokerage", subtype: "taxable",
  value: 100, basis: 50, rothValue: 0, annualAmount: 0,
  ownerSide: "primary", entityOwnedById: null, childIds: [],
};

describe("defaultDisposition", () => {
  it("solely-owned follows the owner", () => {
    expect(defaultDisposition(base)).toEqual({ disposition: "primary", needsDecision: false });
    expect(defaultDisposition({ ...base, ownerSide: "spouse" })).toEqual({ disposition: "spouse", needsDecision: false });
  });
  it("joint/external/none default primary + needsDecision", () => {
    for (const ownerSide of ["joint", "external", "none"] as const) {
      expect(defaultDisposition({ ...base, ownerSide })).toEqual({ disposition: "primary", needsDecision: true });
    }
  });
  it("529 defaults primary WITHOUT needsDecision", () => {
    expect(defaultDisposition({ ...base, subtype: "education_savings", ownerSide: "none" }))
      .toEqual({ disposition: "primary", needsDecision: false });
  });
  it("expenses default primary + needsDecision (no person owner)", () => {
    expect(defaultDisposition({ ...base, kind: "expense", subtype: "living", ownerSide: "none" }).needsDecision).toBe(true);
  });
  it("entity solely owned by one person defaults that side; else duplicate", () => {
    expect(defaultDisposition({ ...base, kind: "entity", subtype: "llc", ownerSide: "spouse" }).disposition).toBe("spouse");
    expect(defaultDisposition({ ...base, kind: "entity", subtype: "trust", ownerSide: "joint" }).disposition).toBe("duplicate");
  });
  it("child family members default duplicate", () => {
    expect(defaultDisposition({ ...base, kind: "family_member", subtype: "child", ownerSide: "none" }).disposition).toBe("duplicate");
  });
});

describe("allowedDispositions / isSplittable", () => {
  it("splittable categories allow split", () => {
    for (const subtype of ["taxable", "cash", "retirement", "annuity", "real_estate"]) {
      expect(isSplittable({ ...base, subtype })).toBe(true);
    }
  });
  it("never-splittable categories", () => {
    for (const subtype of ["life_insurance", "stock_options", "education_savings", "business"]) {
      expect(isSplittable({ ...base, subtype })).toBe(false);
    }
  });
  it("non-account kinds are primary/spouse only (except entity/family_member add duplicate)", () => {
    expect(allowedDispositions({ ...base, kind: "income" })).toEqual(["primary", "spouse"]);
    expect(allowedDispositions({ ...base, kind: "entity" })).toEqual(["primary", "spouse", "duplicate"]);
    expect(allowedDispositions({ ...base, kind: "family_member" })).toEqual(["primary", "spouse", "duplicate"]);
  });
  it("529 allows only primary/spouse", () => {
    expect(allowedDispositions({ ...base, subtype: "education_savings" })).toEqual(["primary", "spouse"]);
  });
});

describe("validateAllocation", () => {
  it("rejects split on unsplittable", () => {
    expect(() => validateAllocation({ ...base, subtype: "life_insurance" }, "split", 50))
      .toThrowError(AllocationError);
  });
  it("rejects split without percent and percent out of range", () => {
    expect(() => validateAllocation(base, "split", null)).toThrowError(AllocationError);
    expect(() => validateAllocation(base, "split", 0)).toThrowError(AllocationError);
    expect(() => validateAllocation(base, "split", 100)).toThrowError(AllocationError);
  });
  it("rejects allocating entity-owned objects", () => {
    expect(() => validateAllocation({ ...base, entityOwnedById: "e1" }, "spouse", null))
      .toThrowError(AllocationError);
  });
  it("accepts a valid split", () => {
    expect(() => validateAllocation(base, "split", 60)).not.toThrow();
  });
});

describe("resolveAllocations", () => {
  it("explicit row overrides default and clears needsDecision", () => {
    const joint = { ...base, ownerSide: "joint" as const };
    const m = resolveAllocations([joint], [
      { targetKind: "account", targetId: "a1", disposition: "split", splitPercentToSpouse: "60.0000" },
    ]);
    expect(m.get("account:a1")).toEqual({
      disposition: "split", splitPercentToSpouse: 60, isDefault: false, needsDecision: false,
    });
  });
  it("missing row falls back to default with isDefault true", () => {
    const m = resolveAllocations([{ ...base, ownerSide: "joint" }], []);
    expect(m.get("account:a1")).toEqual({
      disposition: "primary", splitPercentToSpouse: null, isDefault: true, needsDecision: true,
    });
  });
});
