import { resolveScenarioId } from "./resolve-scenario-id";
import { withComputeCache } from "./cache-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { runProjectionWithEvents } from "@/engine/projection";
import {
  runMonteCarlo,
  createReturnEngine,
  type MonteCarloResult,
} from "@/engine";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import { hashMonteCarloInputs } from "./hash";
import { assembleMonteCarloResult } from "./assemble-monte-carlo-result";

export interface CachedMonteCarloResult {
  payload: MonteCarloReportPayload;
  raw: MonteCarloResult;
  meta: {
    requiredMinimumAssetLevel: number;
    startingLiquidBalance: number;
    planStartYear: number;
    clientBirthYear: number | undefined;
    clientDisplayName: string;
    annualIncomeAtStart: number;
    retirementAge: number;
    spouseRetirementAge: number | undefined;
  };
}

const CANONICAL_TRIALS = 1000;

export async function getOrComputeMonteCarlo(args: {
  clientId: string;
  firmId: string;
  scenarioId: string | "base";
  trials?: number;
  forceRefresh?: boolean;
}): Promise<CachedMonteCarloResult> {
  const trials = args.trials ?? CANONICAL_TRIALS;
  const realScenarioId = await resolveScenarioId(args.clientId, args.scenarioId);

  const { effectiveTree } = await loadEffectiveTree(
    args.clientId,
    args.firmId,
    args.scenarioId,
    {},
  );
  // Pass the effective tree so startingLiquidBalance + the in-estate liquid
  // account set follow this scenario (Depth 1), mirroring the export-pdf route.
  const mcPayload = await loadMonteCarloData(
    args.clientId,
    args.firmId,
    args.scenarioId,
    [],
    effectiveTree,
  );

  const inputHash = hashMonteCarloInputs({ tree: effectiveTree, mcPayload, trials });

  return withComputeCache<CachedMonteCarloResult>({
    firmId: args.firmId,
    clientId: args.clientId,
    realScenarioId,
    kind: "monte_carlo",
    inputHash,
    trials,
    forceRefresh: args.forceRefresh,
    label: "monte_carlo",
    compute: async () => {
      const projection = runProjectionWithEvents(effectiveTree);
      const engine = createReturnEngine({
        indices: mcPayload.indices,
        correlation: mcPayload.correlation,
        seed: mcPayload.seed,
      });
      const accountMixes = new Map(
        mcPayload.accountMixes.map((a) => [a.accountId, a.mix]),
      );
      const raw = await runMonteCarlo({
        data: effectiveTree,
        returnEngine: engine,
        accountMixes,
        trials,
        requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
      });
      const payload = assembleMonteCarloResult({
        tree: effectiveTree,
        mcPayload,
        raw,
        projection,
      });
      return payload;
    },
  });
}
