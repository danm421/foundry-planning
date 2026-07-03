// src/lib/solver/__tests__/warm-start.test.ts
//
// Deterministic warm start for the MC goal-seek solvers: straightline success
// predicate, binary-success localization, and secant MC bracketing.
import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { deterministicLocalize, straightlineSucceeds } from "../warm-start";

// Minimal ProjectionYear shape for the liquid-assets classifier. Matches the
// same cast convention as solver-summary-metrics.test.ts: straightlineSucceeds
// only reads portfolioAssets.{taxableTotal,cashTotal,retirementTotal}, so the
// fixture supplies just those and casts past the full ProjectionYear shape.
const y = (liquid: number) =>
  ({
    portfolioAssets: { taxableTotal: liquid, cashTotal: 0, retirementTotal: 0 },
  }) as unknown as Pick<ProjectionYear, "portfolioAssets">;

describe("straightlineSucceeds", () => {
  it("fails when liquid assets go negative in any year", () => {
    expect(straightlineSucceeds([y(100), y(-1), y(50)], 0)).toBe(false);
  });
  it("fails when the final year is below the required minimum", () => {
    expect(straightlineSucceeds([y(100), y(50)], 60)).toBe(false);
  });
  it("succeeds when non-negative every year and final year >= minimum", () => {
    expect(straightlineSucceeds([y(100), y(60)], 60)).toBe(true);
  });
  it("fails on an empty projection", () => {
    expect(straightlineSucceeds([], 0)).toBe(false);
  });
});

describe("deterministicLocalize", () => {
  it("finds the last succeeding grid value when success sits at the low end (spending)", async () => {
    const calls: number[] = [];
    const succeeds = async (v: number) => {
      calls.push(v);
      return v <= 120_000;
    };
    const seed = await deterministicLocalize({ lo: 0, hi: 300_000, step: 5_000, succeeds });
    expect(seed).toBe(120_000);
    // 2 endpoints + ~log2(60 steps) interior probes.
    expect(calls.length).toBeLessThanOrEqual(10);
  });

  it("finds the first succeeding grid value when success sits at the high end (savings)", async () => {
    const seed = await deterministicLocalize({
      lo: 0,
      hi: 64_000,
      step: 1_000,
      succeeds: async (v) => v >= 23_000,
    });
    expect(seed).toBe(23_000);
  });

  it("returns null when both endpoints succeed (uninformative — the Roth case)", async () => {
    expect(
      await deterministicLocalize({ lo: 0, hi: 100, step: 1, succeeds: async () => true }),
    ).toBeNull();
  });

  it("returns null when both endpoints fail", async () => {
    expect(
      await deterministicLocalize({ lo: 0, hi: 100, step: 1, succeeds: async () => false }),
    ).toBeNull();
  });
});
