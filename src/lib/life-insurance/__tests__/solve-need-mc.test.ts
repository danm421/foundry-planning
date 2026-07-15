import { describe, it, expect } from "vitest";
import { solveLifeInsuranceNeedMc, solveNeedBracket, refineNeed } from "../solve-need-mc";
import { marriedBase, assumptions } from "./test-helpers";

// ── In-memory Monte Carlo payload ────────────────────────────────────────────
// solve-target.ts gets its MonteCarloPayload from `loadMonteCarloData` (a DB
// hit). For a pure unit test we construct an equivalent in-memory payload
// directly — the same shape `runMonteCarlo` consumes — mirroring how
// `src/engine/monteCarlo/__tests__/run.test.ts` builds INDICES/CORR and an
// account-mix Map. The investable accounts in `sampleAccounts` (used by
// `marriedBase()`) are the two retirement, one taxable, and one cash account;
// the synthetic life-insurance policy is non-investable and gets no mix.
const INDICES = [
  { id: "eq", arithMean: 0.08, stdDev: 0.15 },
  { id: "bd", arithMean: 0.04, stdDev: 0.05 },
];
const CORR = [
  [1, 0.1],
  [0.1, 1],
];
const MIX = [
  { assetClassId: "eq", weight: 0.6 },
  { assetClassId: "bd", weight: 0.4 },
];

/** A minimal-but-valid MonteCarloPayload-shaped object. */
function mcPayload() {
  return {
    indices: INDICES,
    correlation: CORR,
    accountMixes: [
      { accountId: "acct-401k", segments: [{ fromYear: 0, mix: MIX }] },
      { accountId: "acct-roth", segments: [{ fromYear: 0, mix: MIX }] },
      { accountId: "acct-brokerage", segments: [{ fromYear: 0, mix: MIX }] },
      { accountId: "acct-savings", segments: [{ fromYear: 0, mix: MIX }] },
    ],
    startingLiquidBalance: 1_050_000,
    seed: 12345,
    requiredMinimumAssetLevel: 0,
  };
}

describe("solveLifeInsuranceNeedMc", () => {
  it("solves a face value whose Monte Carlo score meets the target", async () => {
    // requiredMinimumAssetLevel drives the survivor's leave-to-heirs floor.
    // Pick a target the survivor cannot clear at $0 face value so the solver
    // must find a positive face value.
    const r = await solveLifeInsuranceNeedMc(
      marriedBase(),
      "client",
      {
        ...assumptions,
        leaveToHeirsAmount: 8_000_000,
        mcTargetScore: 0.85,
      },
      { ...mcPayload(), requiredMinimumAssetLevel: 8_000_000 },
      { trials: 150 },
    );
    expect(r.status).toBe("solved");
    expect(r.faceValue).toBeGreaterThan(0);
    expect(r.achievedScore).toBeGreaterThanOrEqual(0.83);
  }, 30_000);

  it("converges in far fewer evaluations than the old 24-iteration bisection", async () => {
    const r = await solveLifeInsuranceNeedMc(
      marriedBase(),
      "client",
      { ...assumptions, leaveToHeirsAmount: 8_000_000, mcTargetScore: 0.85 },
      { ...mcPayload(), requiredMinimumAssetLevel: 8_000_000 },
      { trials: 150 },
    );
    expect(r.status).toBe("solved");
    // 2 endpoint probes + a handful of root-finder iterations -- well under
    // the old fixed budget of MAX_ITERATIONS + 2 = 26.
    expect(r.iterations).toBeLessThanOrEqual(14);
    // Also assert solution quality: a fast-but-wrong convergence (e.g. a bug
    // reconstructing f(x) from g-space) would pass the iteration bound alone.
    expect(r.achievedScore).toBeGreaterThanOrEqual(0.83);
  }, 30_000);

  it("reports exceeds-cap when even the 20M cap cannot meet the target", async () => {
    const r = await solveLifeInsuranceNeedMc(
      marriedBase(),
      "client",
      {
        ...assumptions,
        leaveToHeirsAmount: 10_000_000_000,
        mcTargetScore: 0.85,
      },
      { ...mcPayload(), requiredMinimumAssetLevel: 10_000_000_000 },
      { trials: 100 },
    );
    expect(r.status).toBe("exceeds-cap");
    expect(r.faceValue).toBe(20_000_000);
  }, 30_000);
});

describe("solveNeedBracket (pure bracket orchestration)", () => {
  const opts = { target: 0.9, cap: 20_000_000, tolerance: 0.02, maxIterations: 24 };

  it("returns faceValue 0 when atZero already meets target", async () => {
    const evaluate = async () => 0.95; // funded at $0
    const r = await solveNeedBracket(evaluate, opts);
    expect(r).toEqual({ status: "solved", faceValue: 0, achievedScore: 0.95 });
  });

  it("returns exceeds-cap when even the cap falls far short", async () => {
    const evaluate = async () => 0.4; // flat, never reaches target
    const r = await solveNeedBracket(evaluate, opts);
    expect(r.status).toBe("exceeds-cap");
    expect(r.faceValue).toBe(20_000_000);
  });

  it("solves a positive face value on a valid bracket", async () => {
    // Monotone in face: 0.5 at $0 rising to ~0.95 at cap; crosses 0.9 mid-range.
    const evaluate = async (f: number) => 0.5 + 0.45 * (f / 20_000_000);
    const r = await solveNeedBracket(evaluate, opts);
    expect(r.status).toBe("solved");
    expect(r.faceValue).toBeGreaterThan(0);
    expect(r.faceValue).toBeLessThan(20_000_000);
    expect(Math.abs(r.achievedScore - 0.9)).toBeLessThanOrEqual(0.02);
  });

  it("F1/F7: atCap within tolerance BELOW target → exceeds-cap, not solved≈$20M", async () => {
    // Max achievable score (at cap) is 0.89 against a 0.90 target — i.e. inside
    // [target - tolerance, target). The buggy guard let this fall through and
    // returned a ~$20M policy labeled "solved".
    const evaluate = async (f: number) => 0.5 + 0.39 * (f / 20_000_000); // $0→0.5, cap→0.89
    const r = await solveNeedBracket(evaluate, opts);
    expect(r.status).toBe("exceeds-cap");
    expect(r.faceValue).toBe(20_000_000);
    expect(r.achievedScore).toBeLessThan(0.9);
  });

  it("F16: tiny target with survivor below it does NOT return faceValue 0", async () => {
    const tinyOpts = { ...opts, target: 0.01 };
    // Survivor fails at $0 (score 0), but a positive face reaches 1%.
    const evaluate = async (f: number) => Math.min(0.5, f / 20_000_000); // $0→0, rises
    const r = await solveNeedBracket(evaluate, tinyOpts);
    expect(r.status === "solved" && r.faceValue === 0).toBe(false);
  });

  it("F16: tiny target already met at $0 still returns faceValue 0", async () => {
    const tinyOpts = { ...opts, target: 0.01 };
    const evaluate = async () => 0.05; // 5% ≥ 1% target at $0
    const r = await solveNeedBracket(evaluate, tinyOpts);
    expect(r).toEqual({ status: "solved", faceValue: 0, achievedScore: 0.05 });
  });

  it("normal target funded within tolerance band still returns faceValue 0", async () => {
    // target 0.90, atZero 0.89 — inside the comfort band, keep returning 0.
    const evaluate = async () => 0.89;
    const r = await solveNeedBracket(evaluate, opts);
    expect(r).toEqual({ status: "solved", faceValue: 0, achievedScore: 0.89 });
  });
});

describe("refineNeed (full-trial refinement of a coarse verdict)", () => {
  const opts = { target: 0.9, cap: 20_000_000, tolerance: 0.02, maxIterations: 24 };
  // Full-trial objective: $0 → 0.5, rising to cross 0.9 at $10M (clamped ≤ 1).
  const nearTen = async (f: number) => Math.min(1, 0.5 + 0.04 * (f / 1_000_000));

  it("refines a coarse positive face to the full-trial root", async () => {
    const r = await refineNeed(
      nearTen,
      { status: "solved", faceValue: 9_500_000, achievedScore: 0.9 },
      opts,
    );
    expect(r.status).toBe("solved");
    expect(Math.abs(r.achievedScore - 0.9)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(r.faceValue - 10_000_000)).toBeLessThan(600_000);
  });

  it("returns the coarse face immediately when full trials already agree", async () => {
    const r = await refineNeed(
      nearTen,
      { status: "solved", faceValue: 10_000_000, achievedScore: 0.9 },
      opts,
    );
    expect(r).toEqual({ status: "solved", faceValue: 10_000_000, achievedScore: 0.9 });
  });

  it("confirms a coarse funded ($0) verdict at full trials", async () => {
    const funded = async () => 0.95;
    const r = await refineNeed(
      funded,
      { status: "solved", faceValue: 0, achievedScore: 0.95 },
      opts,
    );
    expect(r).toEqual({ status: "solved", faceValue: 0, achievedScore: 0.95 });
  });

  it("falls back to a full solve when a coarse funded verdict is wrong at full trials", async () => {
    const r = await refineNeed(
      nearTen, // $0 → 0.5, below target → not actually funded
      { status: "solved", faceValue: 0, achievedScore: 0.91 },
      opts,
    );
    expect(r.status).toBe("solved");
    expect(r.faceValue).toBeGreaterThan(0);
    expect(Math.abs(r.achievedScore - 0.9)).toBeLessThanOrEqual(0.02);
  });

  it("confirms a coarse exceeds-cap verdict at full trials", async () => {
    const flat = async () => 0.4; // never reaches target
    const r = await refineNeed(
      flat,
      { status: "exceeds-cap", faceValue: 20_000_000, achievedScore: 0.4 },
      opts,
    );
    expect(r.status).toBe("exceeds-cap");
    expect(r.faceValue).toBe(20_000_000);
  });

  it("falls back to a full solve when a coarse exceeds-cap verdict is wrong at full trials", async () => {
    const r = await refineNeed(
      nearTen, // reaches target within the cap
      { status: "exceeds-cap", faceValue: 20_000_000, achievedScore: 0.89 },
      opts,
    );
    expect(r.status).toBe("solved");
    expect(r.faceValue).toBeGreaterThan(0);
    expect(r.faceValue).toBeLessThan(20_000_000);
  });
});
