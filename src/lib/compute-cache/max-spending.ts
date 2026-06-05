import { resolveScenarioId } from "./resolve-scenario-id";
import { withComputeCache } from "./cache-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { solveMaxSpending, type MaxSpendResult } from "@/lib/solver/solve-max-spending";
import { hashMaxSpendingInputs } from "./hash";

const DEFAULT_TARGET = 0.85;
const SEARCH_TRIALS = 250;

export async function getOrComputeMaxSpending(args: {
  clientId: string;
  firmId: string;
  scenarioId: string | "base";
  targetPoS?: number;
  forceRefresh?: boolean;
}): Promise<MaxSpendResult> {
  const targetPoS = args.targetPoS ?? DEFAULT_TARGET;
  const realScenarioId = await resolveScenarioId(args.clientId, args.scenarioId);

  const { effectiveTree } = await loadEffectiveTree(args.clientId, args.firmId, args.scenarioId, {});
  const mcPayload = await loadMonteCarloData(
    args.clientId,
    args.firmId,
    args.scenarioId,
    [],
    effectiveTree,
  );
  const inputHash = hashMaxSpendingInputs({ tree: effectiveTree, mcPayload, targetPoS });

  return withComputeCache<MaxSpendResult>({
    firmId: args.firmId,
    clientId: args.clientId,
    realScenarioId,
    kind: "max_spending",
    inputHash,
    trials: SEARCH_TRIALS,
    forceRefresh: args.forceRefresh,
    label: "max_spending",
    compute: () => solveMaxSpending({ tree: effectiveTree, mcPayload, targetPoS, searchTrials: SEARCH_TRIALS }),
  });
}
