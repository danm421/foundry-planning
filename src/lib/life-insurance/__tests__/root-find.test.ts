import { describe, it, expect } from "vitest";
import { findRoot, findRootAsync } from "../root-find";

describe("findRoot", () => {
  it("finds the root of a linear objective within tolerance", () => {
    // f(x) = x; target 50 on bracket [0, 100].
    const r = findRoot(
      { lo: 0, flo: 0, hi: 100, fhi: 100, target: 50, tol: 0.01, maxIterations: 24 },
      (x) => x,
    );
    expect(Math.abs(r.fx - 50)).toBeLessThanOrEqual(0.01);
    expect(r.x).toBeCloseTo(50, 1);
  });

  it("solves an exactly-linear objective in a single evaluation", () => {
    // False position lands the root on the first interpolation for linear f.
    const r = findRoot(
      { lo: 0, flo: 0, hi: 100, fhi: 100, target: 30, tol: 0.01, maxIterations: 24 },
      (x) => x,
    );
    expect(r.iterations).toBe(1);
  });

  it("converges quickly on a convex monotonic objective", () => {
    // f(x) = x^2 on [0, 100]; target 2500 -> root at x = 50.
    const r = findRoot(
      { lo: 0, flo: 0, hi: 100, fhi: 10000, target: 2500, tol: 1, maxIterations: 24 },
      (x) => x * x,
    );
    expect(Math.abs(r.fx - 2500)).toBeLessThanOrEqual(1);
    expect(r.iterations).toBeLessThan(12); // Illinois keeps it fast despite curvature.
  });

  it("handles a step-function objective without stalling", () => {
    // Mimics the MC success-rate objective: a 250-step staircase.
    const f = (x: number) => Math.floor((x / 100) * 250) / 250;
    const r = findRoot(
      { lo: 0, flo: 0, hi: 100, fhi: 1, target: 0.6, tol: 0.02, maxIterations: 24 },
      f,
    );
    expect(Math.abs(r.fx - 0.6)).toBeLessThanOrEqual(0.02);
    expect(r.iterations).toBeLessThan(15);
  });

  it("stops at maxIterations when tolerance can never be met", () => {
    // tol far smaller than the staircase step -> never within tolerance.
    const f = (x: number) => Math.floor(x / 10) * 10;
    const r = findRoot(
      { lo: 0, flo: 0, hi: 100, fhi: 100, target: 55, tol: 0.001, maxIterations: 8 },
      f,
    );
    expect(r.iterations).toBe(8);
  });
});

describe("findRootAsync", () => {
  it("mirrors findRoot for an async objective", async () => {
    const r = await findRootAsync(
      { lo: 0, flo: 0, hi: 100, fhi: 100, target: 50, tol: 0.01, maxIterations: 24 },
      async (x) => x,
    );
    expect(Math.abs(r.fx - 50)).toBeLessThanOrEqual(0.01);
  });

  it("propagates a rejection thrown by the objective", async () => {
    await expect(
      findRootAsync(
        { lo: 0, flo: 0, hi: 100, fhi: 100, target: 50, tol: 0.01, maxIterations: 24 },
        async () => {
          throw new Error("aborted");
        },
      ),
    ).rejects.toThrow("aborted");
  });
});
