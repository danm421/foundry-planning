import { describe, it, expect } from "vitest";
import { deriveInheritanceClass } from "../classify";
import type { RecipientInput } from "../types";

function base(overrides: Partial<RecipientInput>): RecipientInput {
  return {
    key: "r1", label: "Test", grossShare: 100_000, components: [],
    relationship: "other", isMinorChild: false, age: null,
    domesticPartner: false, isCharity: false, isExternalIndividual: false,
    classOverride: undefined,
    primaryResidenceJointlyHeldWithDomesticPartner: false,
    ...overrides,
  };
}

describe("deriveInheritanceClass — PA", () => {
  it("spouse → Class A", () => {
    const r = deriveInheritanceClass("PA", base({ relationship: "spouse" }));
    expect(r).toEqual({ classLabel: "A", classSource: "spouse-role" });
  });

  it("minor child → Class A", () => {
    const r = deriveInheritanceClass("PA", base({ relationship: "child", isMinorChild: true }));
    expect(r).toEqual({ classLabel: "A", classSource: "minor-child" });
  });

  it("adult child → Class B (lineal)", () => {
    const r = deriveInheritanceClass("PA", base({ relationship: "child", isMinorChild: false }));
    expect(r).toEqual({ classLabel: "B", classSource: "derived-from-relationship" });
  });

  it("sibling → Class C", () => {
    const r = deriveInheritanceClass("PA", base({ relationship: "sibling" }));
    expect(r).toEqual({ classLabel: "C", classSource: "derived-from-relationship" });
  });

  it("unrelated → Class D", () => {
    const r = deriveInheritanceClass("PA", base({ relationship: "other", isExternalIndividual: true }));
    expect(r).toEqual({ classLabel: "D", classSource: "external-individual" });
  });
});

describe("deriveInheritanceClass — NJ", () => {
  it("dom-partner spouse → Class A via domestic-partner source", () => {
    const r = deriveInheritanceClass("NJ", base({ relationship: "other", domesticPartner: true }));
    expect(r).toEqual({ classLabel: "A", classSource: "domestic-partner" });
  });
  it("adult child → Class A (NJ lineals are all Class A)", () => {
    expect(deriveInheritanceClass("NJ", base({ relationship: "child" })))
      .toEqual({ classLabel: "A", classSource: "derived-from-relationship" });
  });
  it("sibling-in-law → Class C", () => {
    expect(deriveInheritanceClass("NJ", base({ relationship: "sibling_in_law" })))
      .toEqual({ classLabel: "C", classSource: "derived-from-relationship" });
  });
  it("niece → Class D", () => {
    expect(deriveInheritanceClass("NJ", base({ relationship: "niece_nephew" })))
      .toEqual({ classLabel: "D", classSource: "derived-from-relationship" });
  });
});

describe("deriveInheritanceClass — KY", () => {
  it("sibling → Class A (unique to KY)", () => {
    expect(deriveInheritanceClass("KY", base({ relationship: "sibling" })))
      .toEqual({ classLabel: "A", classSource: "derived-from-relationship" });
  });
  it("son-in-law → Class B", () => {
    expect(deriveInheritanceClass("KY", base({ relationship: "child_in_law" })))
      .toEqual({ classLabel: "B", classSource: "derived-from-relationship" });
  });
  it("cousin → Class C", () => {
    expect(deriveInheritanceClass("KY", base({ relationship: "cousin" })))
      .toEqual({ classLabel: "C", classSource: "derived-from-relationship" });
  });
});

describe("deriveInheritanceClass — NE", () => {
  it("spouse → exempt", () => {
    expect(deriveInheritanceClass("NE", base({ relationship: "spouse" })))
      .toEqual({ classLabel: "exempt", classSource: "spouse-role" });
  });
  it("child → Class B", () => {
    expect(deriveInheritanceClass("NE", base({ relationship: "child" })))
      .toEqual({ classLabel: "B", classSource: "derived-from-relationship" });
  });
  it("niece → Class C", () => {
    expect(deriveInheritanceClass("NE", base({ relationship: "niece_nephew" })))
      .toEqual({ classLabel: "C", classSource: "derived-from-relationship" });
  });
});

describe("deriveInheritanceClass — MD", () => {
  it("sibling → Class A", () => {
    expect(deriveInheritanceClass("MD", base({ relationship: "sibling" })))
      .toEqual({ classLabel: "A", classSource: "derived-from-relationship" });
  });
  it("dom-partner → Class A", () => {
    expect(deriveInheritanceClass("MD", base({ relationship: "other", domesticPartner: true })))
      .toEqual({ classLabel: "A", classSource: "domestic-partner" });
  });
  it("niece → Class B", () => {
    expect(deriveInheritanceClass("MD", base({ relationship: "niece_nephew" })))
      .toEqual({ classLabel: "B", classSource: "derived-from-relationship" });
  });
});

describe("deriveInheritanceClass — overrides + carve-outs", () => {
  it("classOverride beats auto-derivation", () => {
    expect(deriveInheritanceClass("PA", base({ relationship: "sibling", classOverride: "B" })))
      .toEqual({ classLabel: "B", classSource: "explicit-override" });
  });
  it("charity → exempt regardless of relationship", () => {
    expect(deriveInheritanceClass("PA", base({ isCharity: true })))
      .toEqual({ classLabel: "exempt", classSource: "charity" });
  });
  it("external individual → highest class (D in PA)", () => {
    expect(deriveInheritanceClass("PA", base({ isExternalIndividual: true })))
      .toEqual({ classLabel: "D", classSource: "external-individual" });
  });
  it("external individual → C in KY", () => {
    expect(deriveInheritanceClass("KY", base({ isExternalIndividual: true })))
      .toEqual({ classLabel: "C", classSource: "external-individual" });
  });
});
