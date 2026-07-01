// src/lib/compute-cache/solver-mc.ts
//
// Probability-of-success for the Live Solver's two gauges, served from cache.
// No diverging edits → the effective tree IS the source scenario, so delegate
// to the persistent per-scenario cache (getOrComputeMonteCarlo). Edited working
// trees → a transient hash-addressed cache (solver_mc_cache), computed
// server-side so the browser never blocks.
import { db } from "@/db";
import { solverMcCache } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import { getOrComputeMonteCarlo } from "./monte-carlo";
import { hashMonteCarloInputs } from "./hash";
import { singleFlight } from "./single-flight";
import { createReturnEngine, runMonteCarlo } from "@/engine";
import { runProjectionWithEvents } from "@/engine/projection";
import { assembleMonteCarloResult } from "./assemble-monte-carlo-result";
import type { CachedMonteCarloResult } from "./monte-carlo";
import type { SolverMutation } from "@/lib/solver/types";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";

const CANONICAL_TRIALS = 1000;
// Transient rows expire after 7 days; keyed by input hash so stale entries are harmless.
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SolverMcResult {
  successRate: number;
}

type EditedInputs = {
  mutated: Awaited<ReturnType<typeof loadEffectiveTree>>["effectiveTree"];
  mcPayload: Awaited<ReturnType<typeof loadMonteCarloData>>;
  inputHash: string;
};

async function loadEditedInputs(args: {
  clientId: string;
  firmId: string;
  source: string | "base";
  mutations: SolverMutation[];
  extraAccountMixes?: ReadonlyArray<{ accountId: string; mix: AccountAssetMix[] }>;
}): Promise<EditedInputs> {
  const { clientId, firmId, source, mutations, extraAccountMixes } = args;
  const { effectiveTree, resolutionContext } = await loadEffectiveTree(clientId, firmId, source, {});
  let mutated = applyMutations(effectiveTree, mutations);
  if (resolutionContext) {
    mutated = resolveTechniqueMutations(mutated, mutations, resolutionContext);
  }
  const mcPayload = await loadMonteCarloData(clientId, firmId, source, extraAccountMixes ?? [], mutated);
  const inputHash = hashMonteCarloInputs({ tree: mutated, mcPayload, trials: CANONICAL_TRIALS });
  return { mutated, mcPayload, inputHash };
}

async function readSolverMcRow(clientId: string, inputHash: string) {
  try {
    const [row] = await db
      .select()
      .from(solverMcCache)
      .where(and(eq(solverMcCache.clientId, clientId), eq(solverMcCache.inputHash, inputHash)));
    return row ?? null;
  } catch (err) {
    console.error("solver_mc cache read failed; recomputing", err);
    return null;
  }
}

function computeAndCacheEdited(
  firmId: string,
  clientId: string,
  inputs: EditedInputs,
): Promise<CachedMonteCarloResult> {
  const { mutated, mcPayload, inputHash } = inputs;
  // Coalesce the gauge + report fetches for the same edited tree: they fire in
  // the same tick and both miss the cache, so without this they'd each run a
  // full ~75s 1000-trial Monte Carlo and time-slice the CPU. One run, shared.
  return singleFlight(`solver:${clientId}:${inputHash}`, async () => {
    const engine = createReturnEngine({
      indices: mcPayload.indices,
      correlation: mcPayload.correlation,
      seed: mcPayload.seed,
    });
    const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));
    const raw = await runMonteCarlo({
      data: mutated,
      returnEngine: engine,
      accountMixes,
      trials: CANONICAL_TRIALS,
      requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
    });
    const projection = runProjectionWithEvents(mutated);
    const result = assembleMonteCarloResult({ tree: mutated, mcPayload, raw, projection });
    try {
      await db
        .insert(solverMcCache)
        .values({ firmId, clientId, inputHash, successRate: raw.successRate, result })
        .onConflictDoUpdate({
          target: [solverMcCache.clientId, solverMcCache.inputHash],
          set: { successRate: raw.successRate, result, computedAt: new Date() },
        });
      // Opportunistic age prune (bounded by the computed_at index).
      await db
        .delete(solverMcCache)
        .where(lt(solverMcCache.computedAt, new Date(Date.now() - PRUNE_AGE_MS)));
    } catch (err) {
      console.error("solver_mc cache write failed; returning fresh result", err);
    }
    return result;
  });
}

export async function getOrComputeSolverMc(args: {
  clientId: string;
  firmId: string;
  source: string | "base";
  mutations: SolverMutation[];
  extraAccountMixes?: ReadonlyArray<{ accountId: string; mix: AccountAssetMix[] }>;
  forceRefresh?: boolean;
}): Promise<SolverMcResult> {
  // No edits → the effective tree is the source scenario itself. Reuse the
  // persistent per-scenario cache (warmed by the report/overview pages).
  if (args.mutations.length === 0) {
    const cached = await getOrComputeMonteCarlo({
      clientId: args.clientId,
      firmId: args.firmId,
      scenarioId: args.source,
      forceRefresh: args.forceRefresh,
    });
    return { successRate: cached.raw.successRate };
  }
  const inputs = await loadEditedInputs(args);
  if (!args.forceRefresh) {
    const row = await readSolverMcRow(args.clientId, inputs.inputHash);
    if (row) return { successRate: row.successRate };
  }
  const result = await computeAndCacheEdited(args.firmId, args.clientId, inputs);
  return { successRate: result.raw.successRate };
}

export async function getOrComputeSolverMcReport(args: {
  clientId: string;
  firmId: string;
  source: string | "base";
  mutations: SolverMutation[];
  extraAccountMixes?: ReadonlyArray<{ accountId: string; mix: AccountAssetMix[] }>;
  forceRefresh?: boolean;
}): Promise<CachedMonteCarloResult> {
  if (args.mutations.length === 0) {
    return getOrComputeMonteCarlo({
      clientId: args.clientId,
      firmId: args.firmId,
      scenarioId: args.source,
      forceRefresh: args.forceRefresh,
    });
  }
  const inputs = await loadEditedInputs(args);
  if (!args.forceRefresh) {
    const row = await readSolverMcRow(args.clientId, inputs.inputHash);
    if (row?.result) return row.result as CachedMonteCarloResult;
  }
  return computeAndCacheEdited(args.firmId, args.clientId, inputs);
}
