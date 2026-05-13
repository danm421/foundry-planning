// src/lib/tax/state-income/__tests__/retirement-subtraction.test.ts
import { describe, it, expect } from "vitest";
import { computeRetirementSubtraction } from "../retirement-subtraction";
import type { RetirementRule } from "../types";

const AL: RetirementRule = {
  applies: { db: true, ira: false, k401: false, annuity: false },
  notes: "",
};
const AR: RetirementRule = {
  applies: { db: true, ira: true, k401: true, annuity: true },
  perFilerCap: 6_000,
  notes: "",
};
const CT: RetirementRule = {
  applies: { db: true, ira: false, k401: false, annuity: true },
  agiThresholdSingle: 75_000,
  agiThresholdJoint: 100_000,
  notes: "",
};

describe("computeRetirementSubtraction", () => {
  it("AL exempts DB pension only", () => {
    const r = computeRetirementSubtraction({
      rule: AL,
      breakdown: { db: 30_000, ira: 10_000, k401: 5_000, annuity: 2_000 },
      isJoint: false,
      age: 70,
      agi: 100_000,
      filers: 1,
    });
    expect(r.amount).toBe(30_000);
  });

  it("AR caps total subtraction at $6K per filer", () => {
    const r = computeRetirementSubtraction({
      rule: AR,
      breakdown: { db: 0, ira: 30_000, k401: 0, annuity: 0 },
      isJoint: false,
      age: 70,
      agi: 100_000,
      filers: 1,
    });
    expect(r.amount).toBe(6_000);
  });

  it("AR with married_joint applies $6K per filer × 2 = $12K cap", () => {
    const r = computeRetirementSubtraction({
      rule: AR,
      breakdown: { db: 0, ira: 30_000, k401: 0, annuity: 0 },
      isJoint: true,
      age: 70,
      agi: 100_000,
      filers: 2,
    });
    expect(r.amount).toBe(12_000);
  });

  it("CT below joint AGI threshold → full subtraction of qualifying", () => {
    const r = computeRetirementSubtraction({
      rule: CT,
      breakdown: { db: 20_000, ira: 30_000, k401: 0, annuity: 5_000 },
      isJoint: true,
      age: 70,
      agi: 80_000,
      filers: 2,
    });
    // DB + annuity qualify; IRA does not. 20K + 5K = 25K
    expect(r.amount).toBe(25_000);
  });

  it("CT above joint AGI threshold → no subtraction (cliff)", () => {
    const r = computeRetirementSubtraction({
      rule: CT,
      breakdown: { db: 20_000, ira: 30_000, k401: 0, annuity: 5_000 },
      isJoint: true,
      age: 70,
      agi: 120_000,
      filers: 2,
    });
    expect(r.amount).toBe(0);
  });

  it("age below ageThreshold → zero subtraction with age-gate note", () => {
    const LA_LIKE: RetirementRule = {
      applies: { db: true, ira: true, k401: true, annuity: true },
      ageThreshold: 65,
      perFilerCap: 6_000,
      notes: "",
    };
    const r = computeRetirementSubtraction({
      rule: LA_LIKE,
      breakdown: { db: 0, ira: 20_000, k401: 0, annuity: 0 },
      isJoint: false,
      age: 60,
      agi: 80_000,
      filers: 1,
    });
    expect(r.amount).toBe(0);
    expect(r.note.toLowerCase()).toContain("age");
    expect(r.note).toContain("60");
    expect(r.note).toContain("65");
  });
});
