// src/lib/tax/state-income/__tests__/ss-subtraction.test.ts
import { describe, it, expect } from "vitest";
import { computeSsSubtraction } from "../ss-subtraction";
import type { SsTreatment } from "../types";

describe("computeSsSubtraction", () => {
  it("exempt → subtracts full taxable SS", () => {
    const r = computeSsSubtraction({
      rule: { kind: "exempt" } as SsTreatment,
      taxableSocialSecurity: 20_000,
      agi: 80_000, age: 70, isJoint: false,
    });
    expect(r.amount).toBe(20_000);
    expect(r.note).toMatch(/exempt/i);
  });
  it("taxed → no subtraction", () => {
    const r = computeSsSubtraction({
      rule: { kind: "taxed" } as SsTreatment,
      taxableSocialSecurity: 20_000,
      agi: 80_000, age: 70, isJoint: false,
    });
    expect(r.amount).toBe(0);
  });
  it("CO conditional + age 65+ → full exemption regardless of AGI", () => {
    const r = computeSsSubtraction({
      rule: {
        kind: "conditional", singleAgiThreshold: 75_000, jointAgiThreshold: 95_000,
        ageFullExemption: 65, notes: "test",
      } as SsTreatment,
      taxableSocialSecurity: 20_000,
      agi: 200_000, age: 67, isJoint: false,
    });
    expect(r.amount).toBe(20_000);
  });
  it("CT conditional, single AGI below threshold → full subtraction", () => {
    const r = computeSsSubtraction({
      rule: {
        kind: "conditional", singleAgiThreshold: 75_000, jointAgiThreshold: 100_000,
        notes: "test",
      } as SsTreatment,
      taxableSocialSecurity: 15_000, agi: 50_000, age: 70, isJoint: false,
    });
    expect(r.amount).toBe(15_000);
  });
  it("CT conditional, single AGI above threshold → no subtraction (cliff)", () => {
    const r = computeSsSubtraction({
      rule: {
        kind: "conditional", singleAgiThreshold: 75_000, jointAgiThreshold: 100_000,
        notes: "test",
      } as SsTreatment,
      taxableSocialSecurity: 15_000, agi: 90_000, age: 70, isJoint: false,
    });
    expect(r.amount).toBe(0);
  });
});
