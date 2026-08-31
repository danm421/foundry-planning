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

  // A6: `shortfall > 0` was true for a fraction of a cent of accumulated
  // per-year rounding, so a 100%-confidence plan printed "spending exceeds
  // available funding by $0 — a shortfall the plan does not currently cover".
  // The guard has to reason about the figure the reader sees, not the raw one.
  it("stays quiet about a shortfall that prints as $0", () => {
    const lines = buildRetirementNarrative({ ...base, shortfall: 0.34 });
    expect(lines.some((l) => l.toLowerCase().includes("shortfall"))).toBe(false);
  });

  it("still warns about the smallest shortfall that prints as a real number", () => {
    const lines = buildRetirementNarrative({ ...base, shortfall: 1 });
    expect(lines.some((l) => l.includes("$1"))).toBe(true);
  });

  it("omits the Monte Carlo number when unavailable", () => {
    const lines = buildRetirementNarrative({ ...base, monteCarloSuccess: null });
    expect(lines[0]).not.toContain("%");
  });
});
