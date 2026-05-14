import { describe, it, expect, vi } from "vitest";
import { bisect } from "../bisect";

describe("bisect", () => {
  it("d=+1 monotonic-up evaluator converges to target within tolerance", async () => {
    // pos(v) = v / 100 — linearly rises from 0.5 at v=50 to 0.8 at v=80
    const evaluate = vi.fn(async (v: number) => v / 100);
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.65,
      evaluate,
    });
    expect(result.status).toBe("converged");
    // Allow ±2 (target ±2% PoS / step 1% PoS per year ≈ 2 years)
    expect(result.solvedValue).toBeGreaterThanOrEqual(63);
    expect(result.solvedValue).toBeLessThanOrEqual(67);
    expect(Math.abs(result.achievedPoS - 0.65)).toBeLessThanOrEqual(0.02);
  });

  it("d=-1 monotonic-down evaluator converges", async () => {
    // pos(v) = 2 - v — at v=0.5 pos=1.5, at v=1.5 pos=0.5
    const evaluate = vi.fn(async (v: number) => 2 - v);
    const result = await bisect({
      lo: 0.5,
      hi: 1.5,
      step: 0.01,
      direction: -1,
      target: 1.0,
      evaluate,
    });
    expect(result.status).toBe("converged");
    expect(Math.abs(result.solvedValue - 1.0)).toBeLessThanOrEqual(0.02);
  });

  it("both endpoints beat target → cheaper endpoint (d=+1: lo)", async () => {
    const evaluate = vi.fn(async () => 0.95);
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.85,
      evaluate,
    });
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(50);
    expect(result.achievedPoS).toBe(0.95);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("both endpoints beat target → cheaper endpoint (d=-1: hi)", async () => {
    const evaluate = vi.fn(async () => 0.95);
    const result = await bisect({
      lo: 0.5,
      hi: 1.5,
      step: 0.01,
      direction: -1,
      target: 0.85,
      evaluate,
    });
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(1.5);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("neither endpoint beats target → unreachable, returns best endpoint", async () => {
    // pos(50) = 0.5, pos(80) = 0.7 — neither hits 0.85
    const evaluate = vi.fn(async (v: number) => 0.5 + (v - 50) / 150);
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.85,
      evaluate,
    });
    expect(result.status).toBe("unreachable");
    expect(result.solvedValue).toBe(80); // hi has higher PoS
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("step-snapping: returns a value on the grid lo + n*step", async () => {
    const evaluate = vi.fn(async (v: number) => v / 100);
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.65,
      evaluate,
    });
    expect(result.solvedValue).toBe(Math.round(result.solvedValue));
  });

  it("max-iterations cap returns the tight bracket endpoint with status=max-iterations", async () => {
    // Evaluator never gets within tolerance — always 0.5 below target on loose side,
    // always 0.99 above target on tight side. Bisection bracket shrinks but
    // achievedPoS never crosses tolerance.
    const evaluate = vi.fn(async (v: number) => (v < 65 ? 0.5 : 0.99));
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.85,
      evaluate,
      maxIterations: 5,
    });
    expect(result.iterations).toBeLessThanOrEqual(5);
    expect(["converged", "max-iterations"]).toContain(result.status);
  });

  it("bracket collapses to one step → converged with closer endpoint", async () => {
    // At each call the evaluator returns a value that just misses tolerance until
    // bracket width drops to one step.
    const evaluate = vi.fn(async (v: number) => (v < 60 ? 0.4 : 0.9));
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.85,
      evaluate,
    });
    expect(result.status).toBe("converged");
    // Result lands on the "tight" side (value with PoS ≥ target).
    expect(result.achievedPoS).toBeGreaterThanOrEqual(0.85);
  });

  it("evaluator called for each iteration (endpoint probes + bisection steps)", async () => {
    const evaluate = vi.fn(async (v: number) => v / 100);
    const result = await bisect({
      lo: 50,
      hi: 80,
      step: 1,
      direction: 1,
      target: 0.65,
      evaluate,
    });
    expect(evaluate.mock.calls.length).toBe(result.iterations);
    expect(result.iterations).toBeGreaterThanOrEqual(2);
    expect(result.iterations).toBeLessThanOrEqual(8);
  });
});
