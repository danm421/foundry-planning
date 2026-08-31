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

/** Everything the builder emits, for the assertions that only care that a
 *  sentence exists somewhere. Which SHEET each lands on has its own test. */
const allLines = (i: Parameters<typeof buildRetirementNarrative>[0]) => {
  const n = buildRetirementNarrative(i);
  return [...n.outlook, ...n.funding];
};

describe("buildRetirementNarrative", () => {
  it("opens with the Monte Carlo read and caps at 4 lines", () => {
    const n = buildRetirementNarrative(base);
    expect(n.outlook[0]).toContain("92%");
    expect(allLines(base).length).toBeLessThanOrEqual(4);
  });

  // A1: the PDF prints two sheets and the second one has ~20pt of slack. A
  // takeaway that belongs to the funding bar is captioned there; repeating the
  // outlook opener under it is what spilled a blank third sheet into the deck.
  it("splits outlook takeaways from funding takeaways", () => {
    const n = buildRetirementNarrative({ ...base, shortfall: 250_000 });
    expect(n.outlook.join(" ")).toContain("plan confidence");
    expect(n.outlook.join(" ")).not.toContain("largest funding source");
    expect(n.funding.join(" ")).toContain("largest funding source");
    expect(n.funding.join(" ")).toContain("shortfall");
    expect(n.funding.join(" ")).not.toContain("plan confidence");
  });

  it("warns when there is a shortfall and skips the warning otherwise", () => {
    const withGap = buildRetirementNarrative({ ...base, shortfall: 250_000 });
    expect(withGap.funding.some((l) => l.toLowerCase().includes("shortfall"))).toBe(true);
    expect(allLines(base).some((l) => l.toLowerCase().includes("shortfall"))).toBe(false);
  });

  // A6: `shortfall > 0` was true for a fraction of a cent of accumulated
  // per-year rounding, so a 100%-confidence plan printed "spending exceeds
  // available funding by $0 — a shortfall the plan does not currently cover".
  // The guard has to reason about the figure the reader sees, not the raw one.
  it("stays quiet about a shortfall that prints as $0", () => {
    const lines = allLines({ ...base, shortfall: 0.34 });
    expect(lines.some((l) => l.toLowerCase().includes("shortfall"))).toBe(false);
  });

  it("still warns about the smallest shortfall that prints as a real number", () => {
    const lines = allLines({ ...base, shortfall: 1 });
    expect(lines.some((l) => l.includes("$1"))).toBe(true);
  });

  it("omits the Monte Carlo number when unavailable", () => {
    const n = buildRetirementNarrative({ ...base, monteCarloSuccess: null });
    expect(n.outlook[0]).not.toContain("%");
  });
});
