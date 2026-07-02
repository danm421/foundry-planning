// src/lib/presentations/pages/life-insurance-summary/__tests__/narrative.test.ts
import { describe, it, expect } from "vitest";
import { buildLifeInsuranceNarrative } from "../narrative";
import type { DecedentRange } from "../view-model";

function range(over: Partial<DecedentRange>): DecedentRange {
  return {
    decedentLabel: "Cooper", deathYear: 2048,
    straightLine: { need: 1_650_000, exceedsCap: false },
    mc: { need: 2_000_000, exceedsCap: false, achievedScorePct: 90 },
    estateTaxAddend: null, existingTotal: 500_000,
    existingPolicies: [{ name: "WL", faceValue: 500_000 }],
    totalRecommended: { low: 2_150_000, high: 2_500_000 },
    hasJoint: false,
    ...over,
  };
}

describe("buildLifeInsuranceNarrative", () => {
  it("opens with the inventory summary and caps at 4 lines", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 1_500_000, policyCount: 3,
      clientRange: range({}), spouseRange: range({ decedentLabel: "Dana" }),
      notSolved: false, jointFootnote: true,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines[0]).toContain("$1.5M");
  });

  it("phrases the need as an additional range on top of in-force coverage", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 500_000, policyCount: 1,
      clientRange: range({}), spouseRange: null,
      notSolved: false, jointFootnote: false,
    });
    const joined = lines.join(" ");
    // fmtUsd keeps one decimal at ≥$1M: 1,650,000 → "$1.6M" (1.65 has no exact
    // binary representation; toFixed(1) rounds down), 2,000,000 → "$2.0M".
    expect(joined).toContain("additional $1.6M–$2.0M");
    expect(joined).toContain("$500k in force");
    expect(joined).toContain("2048");
  });

  it("collapses to a single figure when only the MC bound exists", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 0, policyCount: 0,
      clientRange: range({ straightLine: null, existingTotal: 0, existingPolicies: [] }),
      spouseRange: null, notSolved: false, jointFootnote: false,
    });
    expect(lines.join(" ")).toContain("additional $2.0M");
    expect(lines.join(" ")).not.toContain("–");
  });

  it("says coverage meets the need when additional need is zero", () => {
    const met = range({
      straightLine: { need: 0, exceedsCap: false },
      mc: { need: 0, exceedsCap: false, achievedScorePct: 91 },
      totalRecommended: { low: 500_000, high: 500_000 },
    });
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 500_000, policyCount: 1,
      clientRange: met, spouseRange: null, notSolved: false, jointFootnote: false,
    });
    expect(lines.join(" ")).toContain("meets the modeled need");
  });

  it("flags exceeds-cap", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 0, policyCount: 0,
      clientRange: range({ mc: { need: 20_000_000, exceedsCap: true, achievedScorePct: 70 }, totalRecommended: null }),
      spouseRange: null, notSolved: false, jointFootnote: false,
    });
    expect(lines.join(" ")).toContain("exceeds $20M");
  });

  it("prompts to run the solver when not solved", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 1_000_000, policyCount: 2,
      clientRange: null, spouseRange: null, notSolved: true, jointFootnote: false,
    });
    expect(lines.join(" ").toLowerCase()).toContain("solver");
  });
});
