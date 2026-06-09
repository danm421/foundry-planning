import { describe, it, expect } from "vitest";
import { successByYear } from "../success-by-year";

describe("successByYear", () => {
  it("returns an empty array for an empty matrix", () => {
    expect(successByYear([], 100)).toEqual([]);
  });

  it("computes per-year success rate above the threshold", () => {
    const matrix = [
      [200, 150, 50],   // trial 1: above, above, below
      [200, 80, 40],    // trial 2: above, below, below
      [200, 200, 200],  // trial 3: above, above, above
    ];
    const rates = successByYear(matrix, 100);
    expect(rates).toEqual([1, 2 / 3, 1 / 3]);
  });

  it("uses strict > comparison (equal to threshold counts as failure)", () => {
    const matrix = [[100, 101, 99]];
    expect(successByYear(matrix, 100)).toEqual([0, 1, 0]);
  });
});
