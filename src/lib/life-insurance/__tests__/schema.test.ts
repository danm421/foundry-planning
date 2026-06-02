// src/lib/life-insurance/__tests__/schema.test.ts
import { describe, it, expect } from "vitest";
import { LI_ASSUMPTIONS_SCHEMA } from "../schema";

describe("LI_ASSUMPTIONS_SCHEMA scenarioRef", () => {
  const base = {
    deathYear: 2048, modelPortfolioId: null, leaveToHeirsAmount: 0,
    livingExpenseAtDeath: null, payoffLiabilityIds: [], mcTargetScore: 0.9,
  };
  it("defaults scenarioRef to 'base'", () => {
    const parsed = LI_ASSUMPTIONS_SCHEMA.parse(base);
    expect(parsed.scenarioRef).toBe("base");
  });
  it("accepts an explicit scenario id", () => {
    const parsed = LI_ASSUMPTIONS_SCHEMA.parse({ ...base, scenarioRef: "scn_123" });
    expect(parsed.scenarioRef).toBe("scn_123");
  });
});
