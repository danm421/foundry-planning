import { describe, it, expect } from "vitest";
import { isRevolvingLiability, REVOLVING_LIABILITY_TYPES } from "@/engine/liability-kind";

describe("isRevolvingLiability", () => {
  it("treats credit_card as revolving (held flat)", () => {
    expect(isRevolvingLiability({ liabilityType: "credit_card" })).toBe(true);
  });
  it("treats amortizing types + null/undefined as NOT revolving", () => {
    for (const t of ["mortgage", "heloc", "auto", "student", "personal", "other"] as const) {
      expect(isRevolvingLiability({ liabilityType: t })).toBe(false);
    }
    expect(isRevolvingLiability({ liabilityType: null })).toBe(false);
    expect(isRevolvingLiability({})).toBe(false);
  });
  it("v1 revolving set is exactly credit_card", () => {
    expect([...REVOLVING_LIABILITY_TYPES]).toEqual(["credit_card"]);
  });
});
