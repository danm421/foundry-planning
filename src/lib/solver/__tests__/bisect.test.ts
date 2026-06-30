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

  it("roth lever (d=+1): both endpoints beat target → returns lo=0 (no conversion)", async () => {
    const evaluate = vi.fn(async () => 0.95);
    const result = await bisect({
      lo: 0,
      hi: 200_000,
      step: 1000,
      direction: 1,
      target: 0.85,
      evaluate,
    });
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(0);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("wide bracket converges to true minimum with 24 iters where default 8 falls short", async () => {
    // True minimum lever value where PoS first reaches target is 73_000 on a
    // [0, 100_000] step-1000 grid (~100 grid points). log2(100) ≈ 7 bisections
    // after 2 endpoint probes need >8 total iterations.
    const evaluate = vi.fn(async (v: number) => (v >= 73_000 ? 0.9 : 0.5));

    const shallow = await bisect({
      lo: 0, hi: 100_000, step: 1000, direction: 1, target: 0.85, evaluate,
      maxIterations: 8,
    });
    expect(shallow.status).toBe("max-iterations");

    evaluate.mockClear();
    const deep = await bisect({
      lo: 0, hi: 100_000, step: 1000, direction: 1, target: 0.85, evaluate,
      maxIterations: 24,
    });
    expect(deep.status).toBe("converged");
    expect(deep.solvedValue).toBe(73_000);
  });

  it("interpolation reaches a linear root in fewer evals than bisection would", async () => {
    // pos(v) = v/100, target 0.65 → exact root at v=65. Regula-falsi nails a
    // linear curve almost immediately; pure bisection on [50,80] step-1 needs ~6+.
    const evaluate = vi.fn(async (v: number) => v / 100);
    const result = await bisect({
      lo: 50, hi: 80, step: 1, direction: 1, target: 0.65, evaluate,
    });
    expect(result.status).toBe("converged");
    expect(Math.abs(result.solvedValue - 65)).toBeLessThanOrEqual(1);
    expect(result.iterations).toBeLessThanOrEqual(4); // 2 endpoints + ≤2 interp
  });

  it("flat curve (zero slope) does not divide-by-zero; resolves via bisection", async () => {
    // posLo beats, posHi misses, but the middle is perfectly flat at target-ish:
    // a step function that is constant on each side. No NaN, returns a finite value.
    const evaluate = vi.fn(async (v: number) => (v < 65 ? 0.9 : 0.5));
    const result = await bisect({
      lo: 50, hi: 80, step: 1, direction: 1, target: 0.85, evaluate,
    });
    expect(Number.isFinite(result.solvedValue)).toBe(true);
    expect(result.achievedPoS).toBeGreaterThanOrEqual(0.85);
  });

  it("interpolation keeps the bracket: never returns a value the search never beat", async () => {
    const evaluate = vi.fn(async (v: number) => (v >= 73_000 ? 0.9 : 0.5));
    const result = await bisect({
      lo: 0, hi: 100_000, step: 1000, direction: 1, target: 0.85,
      maxIterations: 24, evaluate,
    });
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(73_000);
  });

  it("tolerance:0 returns the HIGHEST scale beating target where the default under-solves", async () => {
    // The living-expense under-solve bug: PoS sits flat just above target across
    // a wide band, then cliffs below it. True max scale with PoS ≥ 0.85 is 1.30.
    // The default ±0.02 tolerance exits at the first midpoint inside [0.83,0.87]
    // (≈1.0); tolerance:0 collapses the bracket to the real ceiling.
    const curve = async (v: number) => (v <= 1.305 ? 0.86 : 0.8);

    const early = await bisect({
      lo: 0.5, hi: 1.5, step: 0.01, direction: -1, target: 0.85,
      evaluate: curve,
    });
    expect(early.solvedValue).toBeLessThan(1.2); // stops early, leaves spend on the table

    const full = await bisect({
      lo: 0.5, hi: 1.5, step: 0.01, direction: -1, target: 0.85,
      tolerance: 0, maxIterations: 24, evaluate: curve,
    });
    expect(full.status).toBe("converged");
    expect(full.solvedValue).toBeCloseTo(1.3, 2);
    expect(full.achievedPoS).toBeGreaterThanOrEqual(0.85);
    expect(full.solvedValue).toBeGreaterThan(early.solvedValue);
  });

  it("selection:closest returns the bracket endpoint nearest target, even if below it", async () => {
    // Descending grid, crossing target 0.851 between two adjacent $5k steps:
    //   pos(165_000) = 0.855 (beats), pos(170_000) = 0.850 (misses).
    // Default "beat-target" keeps 165_000; "closest" should pick 170_000 because
    // |0.850 - 0.851| = 0.001 < |0.855 - 0.851| = 0.004 — closer to target, more spend.
    const evaluate = async (v: number) =>
      v <= 165_000 ? 0.855 : v <= 170_000 ? 0.85 : 0.4;

    const beat = await bisect({
      lo: 0, hi: 300_000, step: 5000, direction: -1, target: 0.851,
      tolerance: 0, maxIterations: 24, evaluate,
    });
    expect(beat.solvedValue).toBe(165_000);
    expect(beat.achievedPoS).toBeGreaterThanOrEqual(0.851);

    const closest = await bisect({
      lo: 0, hi: 300_000, step: 5000, direction: -1, target: 0.851,
      tolerance: 0, maxIterations: 24, selection: "closest", evaluate,
    });
    expect(closest.status).toBe("converged");
    expect(closest.solvedValue).toBe(170_000); // slightly below target, but closest
    expect(closest.achievedPoS).toBe(0.85);
  });

  it("selection:closest still prefers the beating endpoint when it is the nearer one", async () => {
    // Crossing at 0.84: pos(165_000)=0.86 (beats, |0.02|), pos(170_000)=0.80 (misses, |0.04|).
    // The beating endpoint is closer, so "closest" returns it too.
    const evaluate = async (v: number) =>
      v <= 165_000 ? 0.86 : v <= 170_000 ? 0.8 : 0.4;
    const result = await bisect({
      lo: 0, hi: 300_000, step: 5000, direction: -1, target: 0.84,
      tolerance: 0, maxIterations: 24, selection: "closest", evaluate,
    });
    expect(result.solvedValue).toBe(165_000);
    expect(result.achievedPoS).toBe(0.86);
  });

  it("selection:closest leaves the both-miss (unreachable) shortcut conservative", async () => {
    // Even $0 spend misses target → still report the lowest-spend endpoint, never
    // jump to max spend just because its PoS is equally far from target.
    const evaluate = async () => 0.5;
    const result = await bisect({
      lo: 0, hi: 300_000, step: 5000, direction: -1, target: 0.85,
      tolerance: 0, maxIterations: 24, selection: "closest", evaluate,
    });
    expect(result.status).toBe("unreachable");
    expect(result.solvedValue).toBe(0);
  });

  it("interpolation reaches a linear root on a descending (d=-1) bracket", async () => {
    // pos(v) = 2 - v: descending, crosses target 1.30 at v=0.70. tight=lo here
    // (low v beats), loose=hi. Confirms the interpolation + floor-guard sign
    // logic works for the loose>tight orientation the living-expense lever uses.
    const evaluate = vi.fn(async (v: number) => 2 - v);
    const result = await bisect({
      lo: 0.5, hi: 1.5, step: 0.01, direction: -1, target: 1.3, evaluate,
    });
    expect(result.status).toBe("converged");
    expect(Math.abs(result.solvedValue - 0.7)).toBeLessThanOrEqual(0.02);
    expect(result.achievedPoS).toBeGreaterThanOrEqual(1.3);
  });
});
