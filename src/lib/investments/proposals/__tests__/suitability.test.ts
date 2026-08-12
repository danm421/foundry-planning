import { describe, it, expect } from "vitest";
import { placePortfolio, buildSuitability } from "../suitability";
import type { RungPortfolio } from "../types";

const RUNGS: RungPortfolio[] = [
  { level: "conservative", volatility: 0.05 },
  { level: "moderately_conservative", volatility: 0.08 },
  { level: "moderate", volatility: 0.11 },
  { level: "moderately_aggressive", volatility: 0.14 },
  { level: "aggressive", volatility: 0.18 },
];

describe("placePortfolio", () => {
  it("uses a tagged rung directly and does not mark it estimated", () => {
    expect(placePortfolio("moderate", 0.99, RUNGS)).toEqual({
      level: "moderate",
      estimated: false,
    });
  });

  it("places an untagged portfolio at the nearest rung by volatility", () => {
    expect(placePortfolio(null, 0.135, RUNGS)).toEqual({
      level: "moderately_aggressive",
      estimated: true,
    });
  });

  it("resolves an exact tie to the more conservative rung", () => {
    // 0.095 is equidistant from 0.08 and 0.11. A suitability claim should err
    // toward the lower rung, never the higher one.
    expect(placePortfolio(null, 0.095, RUNGS)).toEqual({
      level: "moderately_conservative",
      estimated: true,
    });
  });

  it("returns null when the firm has tagged no portfolios", () => {
    expect(placePortfolio(null, 0.11, [])).toBeNull();
  });
});

describe("buildSuitability", () => {
  const profile = {
    compositeLevel: "moderate" as const,
    compositeScore: 52,
    bindingConstraint: "tolerance" as const,
    confirmedAt: "2026-01-15",
  };

  it("flags a current portfolio riskier than the client's profile", () => {
    const r = buildSuitability({
      profile,
      currentLevel: "aggressive",
      currentVolatility: 0.18,
      proposedLevel: "moderate",
      proposedVolatility: 0.11,
      rungs: RUNGS,
    });
    expect(r.currentExceedsProfile).toBe(true);
    expect(r.proposedMatchesProfile).toBe(true);
  });

  it("does not flag a current portfolio below the profile", () => {
    const r = buildSuitability({
      profile,
      currentLevel: "conservative",
      currentVolatility: 0.05,
      proposedLevel: "moderate",
      proposedVolatility: 0.11,
      rungs: RUNGS,
    });
    expect(r.currentExceedsProfile).toBe(false);
  });

  it("degrades to nulls with no profile on file and never invents a rung", () => {
    const r = buildSuitability({
      profile: null,
      currentLevel: "aggressive",
      currentVolatility: 0.18,
      proposedLevel: "moderate",
      proposedVolatility: 0.11,
      rungs: RUNGS,
    });
    expect(r.clientLevel).toBeNull();
    expect(r.currentExceedsProfile).toBe(false);
    expect(r.proposedMatchesProfile).toBe(false);
    // Placements still resolve — the scale is drawable, the marker is not.
    expect(r.currentPlacement?.level).toBe("aggressive");
  });

  it("carries the binding constraint through", () => {
    const r = buildSuitability({
      profile: { ...profile, bindingConstraint: "capacity" },
      currentLevel: "moderate",
      currentVolatility: 0.11,
      proposedLevel: "moderate",
      proposedVolatility: 0.11,
      rungs: RUNGS,
    });
    expect(r.bindingConstraint).toBe("capacity");
  });
});
