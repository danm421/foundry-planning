// src/lib/presentations/pages/life-insurance-summary/__tests__/narrative.test.ts
import { describe, it, expect } from "vitest";
import { buildLifeInsuranceNarrative } from "../narrative";
import type { DecedentGap } from "../view-model";

function gap(over: Partial<DecedentGap>): DecedentGap {
  return {
    decedentLabel: "Cooper", have: 1_000_000, need: 2_000_000,
    gap: { kind: "shortfall", amount: 1_000_000 }, exceedsCap: false, hasJoint: false,
    ...over,
  };
}

describe("buildLifeInsuranceNarrative", () => {
  it("opens with the inventory summary and caps at 4 lines", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 1_500_000, policyCount: 3,
      clientGap: gap({}), spouseGap: gap({ decedentLabel: "Dana", gap: { kind: "shortfall", amount: 800_000 } }),
      notSolved: false, jointFootnote: true,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines[0]).toContain("$1.5M");
  });

  it("names shortfalls but not met coverage", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 2_000_000, policyCount: 1,
      clientGap: gap({ gap: { kind: "met", amount: 0 } }),
      spouseGap: null, notSolved: false, jointFootnote: false,
    });
    expect(lines.join(" ")).not.toContain("shortfall");
  });

  it("prompts to run the solver when not solved", () => {
    const lines = buildLifeInsuranceNarrative({
      totalDeathBenefit: 1_000_000, policyCount: 2,
      clientGap: null, spouseGap: null, notSolved: true, jointFootnote: false,
    });
    expect(lines.join(" ").toLowerCase()).toContain("solver");
  });
});
