import { describe, it, expect } from "vitest";
import { buildRetirementNarrative } from "../narrative";

const base = {
  monteCarloSuccess: 0.92,
  liquidEndOfLife: 1_800_000,
  dominantSource: { label: "Social Security", share: 0.41 },
  shortfall: 0,
  ssDelayGain: { name: "John", fromAge: 67, toAge: 70, pctGain: 0.24 },
  rothShare: 0.18,
};

describe("buildRetirementNarrative", () => {
  it("opens with the Monte Carlo read and caps at 4 lines", () => {
    const lines = buildRetirementNarrative(base);
    expect(lines[0]).toContain("92%");
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it("warns when there is a shortfall and skips the warning otherwise", () => {
    const withGap = buildRetirementNarrative({ ...base, shortfall: 250_000 });
    expect(withGap.some((l) => l.toLowerCase().includes("shortfall"))).toBe(true);
    expect(buildRetirementNarrative(base).some((l) => l.toLowerCase().includes("shortfall"))).toBe(false);
  });

  it("omits the Monte Carlo number when unavailable", () => {
    const lines = buildRetirementNarrative({ ...base, monteCarloSuccess: null });
    expect(lines[0]).not.toContain("%");
  });
});
