import { describe, it, expect, vi } from "vitest";
import { runMonteCarlo } from "../run";
import { createReturnEngine } from "../returns";
import { buildClientData } from "../../__tests__/fixtures";
import type { ClientData } from "../../types";

const INDICES = [
  { id: "eq", arithMean: 0.08, stdDev: 0.15 },
  { id: "bd", arithMean: 0.04, stdDev: 0.05 },
];
const CORR = [
  [1, 0.1],
  [0.1, 1],
];

function engine(seed: number) {
  return createReturnEngine({ indices: INDICES, correlation: CORR, seed });
}

function easyPlan(): ClientData {
  const base = buildClientData();
  return { ...base, expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [] };
}

function mixForAll(data: ClientData) {
  return new Map(
    data.accounts
      .filter((a) => a.category === "taxable" || a.category === "retirement" || a.category === "cash")
      .map((a) => [a.id, [
        { assetClassId: "eq", weight: 0.6 },
        { assetClassId: "bd", weight: 0.4 },
      ]])
  );
}

describe("runMonteCarlo — basic shape", () => {
  it("runs the requested number of trials and reports success rate", async () => {
    const data = easyPlan();
    const result = await runMonteCarlo({
      data,
      returnEngine: engine(1),
      accountMixes: mixForAll(data),
      trials: 50,
      requiredMinimumAssetLevel: 0,
    });

    expect(result.requestedTrials).toBe(50);
    expect(result.trialsRun).toBe(50);
    expect(result.aborted).toBe(false);
    expect(result.successfulTrials).toBeGreaterThanOrEqual(0);
    expect(result.successfulTrials).toBeLessThanOrEqual(50);
    expect(result.successRate).toBeCloseTo(result.successfulTrials / 50, 10);
    expect(result.endingLiquidAssets.length).toBe(50);
    expect(result.byYearLiquidAssetsPerTrial.length).toBe(50);
    const years = data.planSettings.planEndYear - data.planSettings.planStartYear + 1;
    expect(result.byYearLiquidAssetsPerTrial[0].length).toBe(years);
  });

  it("uses a default of 1000 trials when not specified", async () => {
    const data = easyPlan();
    const result = await runMonteCarlo({
      data,
      returnEngine: engine(1),
      accountMixes: mixForAll(data),
    });
    expect(result.requestedTrials).toBe(1000);
    expect(result.trialsRun).toBe(1000);
  });
});

describe("runMonteCarlo — determinism", () => {
  it("same inputs → identical aggregate output", async () => {
    const data = easyPlan();
    const mixes = mixForAll(data);

    const a = await runMonteCarlo({ data, returnEngine: engine(42), accountMixes: mixes, trials: 30 });
    const b = await runMonteCarlo({ data, returnEngine: engine(42), accountMixes: mixes, trials: 30 });

    expect(a.successfulTrials).toBe(b.successfulTrials);
    expect(a.endingLiquidAssets).toEqual(b.endingLiquidAssets);
    expect(a.byYearLiquidAssetsPerTrial).toEqual(b.byYearLiquidAssetsPerTrial);
  });

  it("different seeds produce different endings", async () => {
    const data = easyPlan();
    const mixes = mixForAll(data);
    const a = await runMonteCarlo({ data, returnEngine: engine(1), accountMixes: mixes, trials: 30 });
    const b = await runMonteCarlo({ data, returnEngine: engine(2), accountMixes: mixes, trials: 30 });
    expect(a.endingLiquidAssets).not.toEqual(b.endingLiquidAssets);
  });
});

describe("runMonteCarlo — AbortSignal cancellation", () => {
  it("pre-aborted signal → returns partial (empty) result immediately", async () => {
    const data = easyPlan();
    const controller = new AbortController();
    controller.abort();

    const result = await runMonteCarlo({
      data,
      returnEngine: engine(1),
      accountMixes: mixForAll(data),
      trials: 500,
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.trialsRun).toBe(0);
    expect(result.endingLiquidAssets).toEqual([]);
    expect(result.byYearLiquidAssetsPerTrial).toEqual([]);
  });

  it("aborted mid-run → returns partial results with aborted=true", async () => {
    const data = easyPlan();
    const controller = new AbortController();

    // Kick off the run, then abort after a short delay. yieldEvery:1 so the
    // loop yields to the event loop every trial — timer fires promptly.
    const promise = runMonteCarlo({
      data,
      returnEngine: engine(1),
      accountMixes: mixForAll(data),
      trials: 1000,
      signal: controller.signal,
      yieldEvery: 1,
    });
    setTimeout(() => controller.abort(), 0);
    const result = await promise;

    expect(result.aborted).toBe(true);
    expect(result.trialsRun).toBeLessThan(1000);
    expect(result.endingLiquidAssets.length).toBe(result.trialsRun);
    expect(result.byYearLiquidAssetsPerTrial.length).toBe(result.trialsRun);
    // Success rate should still be over the partial set.
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });
});

describe("runMonteCarlo — progress callback", () => {
  it("calls onProgress with (done, total) at each yield boundary", async () => {
    const data = easyPlan();
    const onProgress = vi.fn();
    await runMonteCarlo({
      data,
      returnEngine: engine(1),
      accountMixes: mixForAll(data),
      trials: 20,
      onProgress,
      yieldEvery: 5, // callback fires every 5 trials
    });

    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(20); // final done count
    expect(lastCall[1]).toBe(20); // total
    // Every call's `done` is non-decreasing.
    let prev = 0;
    for (const [done] of onProgress.mock.calls) {
      expect(done).toBeGreaterThanOrEqual(prev);
      prev = done;
    }
  });

  it("a throwing onProgress doesn't abort the run", async () => {
    const data = easyPlan();
    const onProgress = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const result = await runMonteCarlo({
      data,
      returnEngine: engine(1),
      accountMixes: mixForAll(data),
      trials: 10,
      onProgress,
      yieldEvery: 1,
    });
    expect(result.trialsRun).toBe(10);
  });
});
