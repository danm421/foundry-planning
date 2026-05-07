import { describe, it, expect } from "vitest";
import { lx, survivalProbability, deathProbability } from "../mortality";

describe("mortality (Table 2010CM)", () => {
  it("returns 100000 for age 0 (cohort root)", () => {
    expect(lx(0)).toBe(100000);
  });

  it("returns monotonically decreasing lx", () => {
    expect(lx(50)).toBeGreaterThan(lx(60));
    expect(lx(60)).toBeGreaterThan(lx(80));
  });

  it("returns 0 (or near-0) at terminal age 110", () => {
    expect(lx(110)).toBeLessThanOrEqual(1);
  });

  it("survivalProbability(x, t) = lx(x+t)/lx(x)", () => {
    const expected = lx(75) / lx(65);
    expect(survivalProbability(65, 10)).toBeCloseTo(expected, 6);
  });

  it("deathProbability(x, t) = (lx(x+t-1) - lx(x+t)) / lx(x)", () => {
    const expected = (lx(70) - lx(71)) / lx(65);
    expect(deathProbability(65, 6)).toBeCloseTo(expected, 6);
  });

  it("survival to or beyond terminal age is 0", () => {
    expect(survivalProbability(80, 50)).toBe(0);
  });
});
