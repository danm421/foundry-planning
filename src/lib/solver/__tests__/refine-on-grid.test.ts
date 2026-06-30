// src/lib/solver/__tests__/refine-on-grid.test.ts
import { describe, it, expect, vi } from "vitest";
import { refineOnGrid } from "../refine-on-grid";

// Linear truth: PoS(v) = 1 - v/1_000_000  → crosses 0.85 at v = 150_000.
const linearDown = (v: number) => Math.max(0, Math.min(1, 1 - v / 1_000_000));

describe("refineOnGrid", () => {
  it("walks UP to bracket when start PoS is above target (the undershoot fix, d=-1)", async () => {
    const evaluate = vi.fn(async (v: number) => linearDown(v));
    const r = await refineOnGrid({
      start: 130_000, step: 5000, direction: -1, target: 0.85, evaluate,
    });
    expect(r.status).toBe("converged");
    expect(r.solvedValue).toBe(150_000);
    expect(Math.abs(r.achievedPoS - 0.85)).toBeLessThanOrEqual(0.001);
  });

  it("walks DOWN to bracket when start PoS is below target (d=-1)", async () => {
    const evaluate = vi.fn(async (v: number) => linearDown(v));
    const r = await refineOnGrid({
      start: 170_000, step: 5000, direction: -1, target: 0.85, evaluate,
    });
    expect(r.status).toBe("converged");
    expect(r.solvedValue).toBe(150_000);
  });

  it("returns the CLOSEST grid step when the crossing falls between two steps", async () => {
    // target 0.851 → true crossing at v = 149_000; nearest $5k steps are 145k (0.855)
    // and 150k (0.850). |0.850-0.851| < |0.855-0.851| → pick 150k.
    const evaluate = vi.fn(async (v: number) => linearDown(v));
    const r = await refineOnGrid({
      start: 130_000, step: 5000, direction: -1, target: 0.851, evaluate,
    });
    expect(r.solvedValue).toBe(150_000);
    expect(r.achievedPoS).toBeCloseTo(0.85, 5);
  });

  it("start already on target → returns start, evaluates once", async () => {
    const evaluate = vi.fn(async () => 0.85);
    const r = await refineOnGrid({
      start: 100_000, step: 5000, direction: -1, target: 0.85, evaluate,
    });
    expect(r.status).toBe("converged");
    expect(r.solvedValue).toBe(100_000);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("maxSteps cap → status 'capped', returns closest seen", async () => {
    // crossing at 150k is 10 steps from 100k; cap at 3 → never brackets.
    const evaluate = vi.fn(async (v: number) => linearDown(v));
    const r = await refineOnGrid({
      start: 100_000, step: 5000, direction: -1, target: 0.85, maxSteps: 3, evaluate,
    });
    expect(r.status).toBe("capped");
    expect(r.solvedValue).toBe(115_000); // 100k +3 steps, closest of those to 0.85
  });

  it("respects the max bound (both-beat clamp): cannot walk past `max`", async () => {
    const evaluate = vi.fn(async () => 0.99);
    const r = await refineOnGrid({
      start: 300_000, step: 5000, direction: -1, target: 0.85, max: 300_000, evaluate,
    });
    expect(r.status).toBe("capped");
    expect(r.solvedValue).toBe(300_000);
    expect(evaluate).toHaveBeenCalledTimes(1); // start eval only; next step exceeds max
  });

  it("respects the min bound (default 0): cannot walk below it", async () => {
    const evaluate = vi.fn(async () => 0.5); // below target → would want to walk down
    const r = await refineOnGrid({
      start: 0, step: 5000, direction: -1, target: 0.85, evaluate,
    });
    expect(r.status).toBe("capped");
    expect(r.solvedValue).toBe(0);
  });

  it("handles d=+1 (PoS increases with value)", async () => {
    // PoS(v) = v/1_000_000 → crosses 0.85 at 850_000.
    const evaluate = vi.fn(async (v: number) => Math.max(0, Math.min(1, v / 1_000_000)));
    const r = await refineOnGrid({
      start: 800_000, step: 5000, direction: 1, target: 0.85, maxSteps: 12, evaluate,
    });
    expect(r.status).toBe("converged");
    expect(r.solvedValue).toBe(850_000);
  });
});
