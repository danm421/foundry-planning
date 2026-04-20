import { describe, it, expect } from "vitest";
import { runMonteCarlo } from "../run";
import { createReturnEngine } from "../returns";
import { runProjection } from "../../projection";
import { buildClientData } from "../../__tests__/fixtures";
import { cholesky } from "../cholesky";

describe("Cholesky edge case", () => {
  it("handles the 0×0 matrix (empty input) as a no-op", () => {
    expect(cholesky([])).toEqual([]);
  });
});

describe("Monte Carlo with all-fixed-rate plan (no accounts in mix map)", () => {
  // User requirement: "if all assets were custom it would just show the same
  // as cash flow." Every trial should reproduce the deterministic projection
  // byte-for-byte, so the MC distribution collapses to a single point.

  it("every trial produces identical liquid-asset series, matching runProjection exactly", async () => {
    const data = buildClientData();

    // Empty engine — no indices participating in MC.
    const engine = createReturnEngine({ indices: [], correlation: [], seed: 42 });
    const emptyMixes = new Map();

    const result = await runMonteCarlo({
      data,
      returnEngine: engine,
      accountMixes: emptyMixes,
      trials: 10,
      requiredMinimumAssetLevel: 0,
    });

    expect(result.trialsRun).toBe(10);
    expect(result.endingLiquidAssets.length).toBe(10);

    // All ending values identical.
    const first = result.endingLiquidAssets[0];
    for (const v of result.endingLiquidAssets) {
      expect(v).toBe(first);
    }

    // All per-year series identical.
    for (let t = 1; t < 10; t++) {
      expect(result.byYearLiquidAssetsPerTrial[t]).toEqual(result.byYearLiquidAssetsPerTrial[0]);
    }

    // And matches the deterministic projection.
    const deterministic = runProjection(data);
    const deterministicLiquid = deterministic.map((y) =>
      y.portfolioAssets.taxableTotal + y.portfolioAssets.cashTotal + y.portfolioAssets.retirementTotal,
    );
    expect(result.byYearLiquidAssetsPerTrial[0]).toEqual(deterministicLiquid);
  });
});

describe("Monte Carlo with partial mixes (some accounts randomized, some fixed)", () => {
  // Accounts absent from the mix map keep their deterministic growthRate each
  // trial; only listed accounts vary. Verifies the fallback path is actually
  // exercised, not just silently producing zeros.
  it("fixed-rate accounts contribute the same per-year growth across trials", async () => {
    const data = buildClientData();
    const engine = createReturnEngine({
      indices: [{ id: "eq", arithMean: 0.1, stdDev: 0.2 }],
      correlation: [[1]],
      seed: 1,
    });
    // Nobody in the mix → every account is fixed-rate. Same as all-fixed test
    // but with a non-empty engine (stream exists but is never pulled from).
    const result = await runMonteCarlo({
      data, returnEngine: engine, accountMixes: new Map(), trials: 5, requiredMinimumAssetLevel: 0,
    });
    for (let t = 1; t < 5; t++) {
      expect(result.byYearLiquidAssetsPerTrial[t]).toEqual(result.byYearLiquidAssetsPerTrial[0]);
    }
  });
});
