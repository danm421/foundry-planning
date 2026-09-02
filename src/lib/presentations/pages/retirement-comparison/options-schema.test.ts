// src/lib/presentations/pages/retirement-comparison/options-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  retirementComparisonOptionsSchema,
  RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
} from "./options-schema";

describe("retirementComparisonOptionsSchema", () => {
  it("accepts the default options", () => {
    const parsed = retirementComparisonOptionsSchema.safeParse(
      RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown tone", () => {
    const bad = {
      ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
      ai: { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT.ai, tone: "spicy" },
    };
    expect(retirementComparisonOptionsSchema.safeParse(bad).success).toBe(false);
  });

  it("defaults the baseline to Base Case", () => {
    expect(RETIREMENT_COMPARISON_OPTIONS_DEFAULT.baselineScenarioId).toBe("base");
  });

  it("defaults a missing baseline on a deck saved before the field existed", () => {
    // A stored deck is re-parsed through this schema at the API boundary
    // (render-presentation-pdf.ts:81). Without .default("base") it would 400.
    const legacy: Record<string, unknown> = { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT };
    delete legacy.baselineScenarioId;
    const parsed = retirementComparisonOptionsSchema.parse(legacy);
    expect(parsed.baselineScenarioId).toBe("base");
  });
});
