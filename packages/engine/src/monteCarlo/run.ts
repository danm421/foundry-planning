import type { ClientData } from "../types";
import type { ReturnEngine } from "./returns";
import { runTrial, type AccountAssetMix } from "./trial";

export interface RunMonteCarloInput {
  data: ClientData;
  returnEngine: ReturnEngine;
  accountMixes: Map<string, AccountAssetMix[]>;
  /** Number of trials to run. eMoney whitepaper default = 1000 (p.12). */
  trials?: number;
  /** PDF p.14: "Minimum Assets for Solving" — end-of-sim threshold. */
  requiredMinimumAssetLevel?: number;
  /** Optional signal for mid-run cancellation. The loop checks it at each
   *  yield boundary; abort handling is cooperative, not preemptive. */
  signal?: AbortSignal;
  /** Called as `(done, total)` at each yield boundary and after the final
   *  trial. Thrown errors inside the callback are swallowed to keep the run
   *  going — it's advisory, not authoritative. */
  onProgress?: (done: number, total: number) => void;
  /** Yield to the event loop every N trials. Default 50 — balances progress
   *  granularity against setTimeout overhead. Set to 1 for tight cancellation
   *  in tests; the shipping defaults are fine for production. */
  yieldEvery?: number;
}

export interface MonteCarloResult {
  requestedTrials: number;
  /** Actual trials completed (equals requestedTrials unless aborted). */
  trialsRun: number;
  successfulTrials: number;
  /** successfulTrials / trialsRun; 0 when trialsRun = 0. */
  successRate: number;
  /** One entry per completed trial. */
  endingLiquidAssets: number[];
  /** Liquid portfolio series per trial. Rows are trials; cols are plan years. */
  byYearLiquidAssetsPerTrial: number[][];
  aborted: boolean;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runMonteCarlo(input: RunMonteCarloInput): Promise<MonteCarloResult> {
  const trials = input.trials ?? 1000;
  const requiredMinimumAssetLevel = input.requiredMinimumAssetLevel ?? 0;
  const yieldEvery = input.yieldEvery ?? 50;
  const { data, returnEngine, accountMixes, signal, onProgress } = input;

  const endingLiquidAssets: number[] = [];
  const byYearLiquidAssetsPerTrial: number[][] = [];
  let successfulTrials = 0;
  let aborted = false;

  const safeProgress = (done: number) => {
    if (!onProgress) return;
    try {
      onProgress(done, trials);
    } catch {
      // Swallow — progress is advisory, shouldn't kill the run.
    }
  };

  for (let t = 0; t < trials; t++) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    const result = runTrial({
      data,
      returnEngine,
      trialIndex: t,
      accountMixes,
      requiredMinimumAssetLevel,
    });
    if (result.success) successfulTrials++;
    endingLiquidAssets.push(result.endingLiquidAssets);
    byYearLiquidAssetsPerTrial.push(result.byYearLiquidAssets);

    if ((t + 1) % yieldEvery === 0) {
      safeProgress(t + 1);
      await yieldToEventLoop();
    }
  }

  if (!aborted) safeProgress(endingLiquidAssets.length);

  const trialsRun = endingLiquidAssets.length;
  return {
    requestedTrials: trials,
    trialsRun,
    successfulTrials,
    successRate: trialsRun === 0 ? 0 : successfulTrials / trialsRun,
    endingLiquidAssets,
    byYearLiquidAssetsPerTrial,
    aborted,
  };
}
