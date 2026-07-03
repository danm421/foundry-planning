// src/lib/solver/__tests__/warm-start.test.ts
//
// Deterministic warm start for the MC goal-seek solvers: straightline success
// predicate, binary-success localization, and secant MC bracketing.
import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { bracketFromSeed, deterministicLocalize, straightlineSucceeds } from "../warm-start";

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

describe("bracketFromSeed", () => {
  // PoS falls linearly with spend: 1.0 at $0 → 0.0 at $200k; crosses 0.85 at $30k.
  const posCurve = (v: number) => Math.max(0, Math.min(1, 1 - v / 200_000));

  it("brackets the target within the probe budget on a spending-shaped curve", async () => {
    const calls: number[] = [];
    const out = await bracketFromSeed({
      seed: 100_000,
      lo: 0,
      hi: 300_000,
      step: 5_000,
      direction: -1,
      target: 0.85,
      evaluate: async (v) => {
        calls.push(v);
        return posCurve(v);
      },
    });
    expect(out.kind).toBe("bracket");
    if (out.kind !== "bracket") return;
    expect(out.lo).toBeLessThanOrEqual(30_000);
    expect(out.hi).toBeGreaterThanOrEqual(30_000);
    expect(out.posLo).toBe(posCurve(out.lo));
    expect(out.posHi).toBe(posCurve(out.hi));
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it("brackets on a rising (direction +1) savings-shaped curve", async () => {
    // PoS rises with contribution: 0.5 at $0 → 1.0 at $40k; crosses 0.85 at $28k.
    const rising = (v: number) => Math.min(1, 0.5 + (v / 40_000) * 0.5);
    const out = await bracketFromSeed({
      seed: 20_000,
      lo: 0,
      hi: 40_000,
      step: 1_000,
      direction: 1,
      target: 0.85,
      evaluate: async (v) => rising(v),
    });
    expect(out.kind).toBe("bracket");
    if (out.kind !== "bracket") return;
    expect(out.lo).toBeLessThanOrEqual(28_000);
    expect(out.hi).toBeGreaterThanOrEqual(28_000);
  });

  it("resolves unreachable when the PoS-maximizing endpoint still misses the target", async () => {
    // Flat 0.5 curve: even $0 spend can't reach 0.85.
    const out = await bracketFromSeed({
      seed: 120_000,
      lo: 0,
      hi: 300_000,
      step: 5_000,
      direction: -1,
      target: 0.85,
      evaluate: async () => 0.5,
    });
    expect(out).toEqual({
      kind: "result",
      status: "unreachable",
      solvedValue: 0,
      achievedPoS: 0.5,
    });
  });

  it("resolves both-beat converged at the cheap endpoint when PoS beats target everywhere", async () => {
    // Flat 0.9 curve on a spending lever: max spend still succeeds.
    const out = await bracketFromSeed({
      seed: 100_000,
      lo: 0,
      hi: 300_000,
      step: 5_000,
      direction: -1,
      target: 0.85,
      evaluate: async () => 0.9,
    });
    expect(out).toEqual({
      kind: "result",
      status: "converged",
      solvedValue: 300_000,
      achievedPoS: 0.9,
    });
  });

  it("falls back when the probe budget is exhausted without a bracket", async () => {
    // Adversarial: PoS creeps toward the target but never crosses, and never
    // sends the secant to an endpoint (finite positive slope throughout).
    const byCall = [0.5, 0.6, 0.7, 0.75];
    let i = 0;
    const out = await bracketFromSeed({
      seed: 150_000,
      lo: 0,
      hi: 300_000,
      step: 5_000,
      direction: -1,
      target: 0.85,
      maxProbes: 4,
      evaluate: async () => byCall[Math.min(i++, byCall.length - 1)],
    });
    expect(out).toEqual({ kind: "fallback" });
  });
});
