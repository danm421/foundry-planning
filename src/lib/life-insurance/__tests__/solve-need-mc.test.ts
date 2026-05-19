import { describe, it, expect } from "vitest";
import { solveLifeInsuranceNeedMc } from "../solve-need-mc";
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
      { accountId: "acct-401k", mix: MIX },
      { accountId: "acct-roth", mix: MIX },
      { accountId: "acct-brokerage", mix: MIX },
      { accountId: "acct-savings", mix: MIX },
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
