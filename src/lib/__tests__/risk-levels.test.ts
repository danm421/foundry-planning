import { describe, expect, it } from "vitest";
import { RISK_LEVELS, RISK_LEVEL_LABELS, isRiskLevel } from "@/lib/risk-levels";

describe("risk-levels", () => {
  it("has exactly the five rungs in ascending order", () => {
    expect(RISK_LEVELS).toEqual([
      "conservative",
      "moderately_conservative",
      "moderate",
      "moderately_aggressive",
      "aggressive",
    ]);
  });

  it("labels every rung", () => {
    for (const level of RISK_LEVELS) {
      expect(RISK_LEVEL_LABELS[level]).toBeTruthy();
    }
  });

  it("guards membership", () => {
    expect(isRiskLevel("moderate")).toBe(true);
    expect(isRiskLevel("balanced")).toBe(false);
    expect(isRiskLevel(null)).toBe(false);
    expect(isRiskLevel(3)).toBe(false);
  });
});
