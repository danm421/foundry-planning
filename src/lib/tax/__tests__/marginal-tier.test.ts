import { describe, it, expect } from "vitest";
import { findMarginalTier } from "../federal";
import type { BracketTier } from "../types";

const brackets: BracketTier[] = [
  { from: 0,        to: 23200,  rate: 0.10 },
  { from: 23200,    to: 94300,  rate: 0.12 },
  { from: 94300,    to: 201050, rate: 0.22 },
  { from: 201050,   to: 383900, rate: 0.24 },
  { from: 383900,   to: null,   rate: 0.37 },
];

describe("findMarginalTier", () => {
  it("returns the first tier for zero income", () => {
    expect(findMarginalTier(0, brackets)).toEqual(brackets[0]);
  });

  it("returns the first tier for negative income", () => {
    expect(findMarginalTier(-1000, brackets)).toEqual(brackets[0]);
  });

  it("places income inside a tier in that tier", () => {
    expect(findMarginalTier(100000, brackets)).toEqual(brackets[2]); // 22%
  });

  it("places income exactly at a boundary in the upper tier", () => {
    // Mirrors calcMarginalRate: 23200 → 12%, not 10%.
    expect(findMarginalTier(23200, brackets)).toEqual(brackets[1]);
  });

  it("returns the top tier (to === null) for income above all bounded tiers", () => {
    const tier = findMarginalTier(500000, brackets);
    expect(tier?.rate).toBe(0.37);
    expect(tier?.to).toBeNull();
  });

  it("returns the top tier for income exactly at the highest bounded edge", () => {
    expect(findMarginalTier(383900, brackets)).toEqual(brackets[4]);
  });

  it("returns null for an empty bracket array", () => {
    expect(findMarginalTier(50000, [])).toBeNull();
  });
});
