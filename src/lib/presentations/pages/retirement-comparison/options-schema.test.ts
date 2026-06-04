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
});
