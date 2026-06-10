// src/lib/compute-cache/solver-mc.ts
//
// Probability-of-success for the Live Solver's two gauges, served from cache.
// No diverging edits → the effective tree IS the source scenario, so delegate
// to the persistent per-scenario cache (getOrComputeMonteCarlo). Edited working
// trees → a transient hash-addressed cache (solver_mc_cache), computed
// server-side so the browser never blocks. The solver only needs successRate.
import { db } from "@/db";
import { solverMcCache } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import { getOrComputeMonteCarlo } from "./monte-carlo";
import { hashMonteCarloInputs } from "./hash";
import { createReturnEngine, runMonteCarlo } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";

const CANONICAL_TRIALS = 1000;
// Transient rows expire after 7 days; keyed by input hash so stale entries are harmless.
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SolverMcResult {
  successRate: number;
}

export async function getOrComputeSolverMc(args: {
  clientId: string;
  firmId: string;
  source: string | "base";
  mutations: SolverMutation[];
  extraAccountMixes?: ReadonlyArray<{ accountId: string; mix: AccountAssetMix[] }>;
  forceRefresh?: boolean;
}): Promise<SolverMcResult> {
  const { clientId, firmId, source, mutations, extraAccountMixes, forceRefresh } = args;

  // No edits → the effective tree is the source scenario itself. Reuse the
  // persistent per-scenario cache (warmed by the report/overview pages).
  if (mutations.length === 0) {
    const cached = await getOrComputeMonteCarlo({
      clientId,
      firmId,
      scenarioId: source,
      forceRefresh,
    });
    return { successRate: cached.raw.successRate };
  }

  // Edited working tree → build it server-side, then hit the transient cache.
  const { effectiveTree, resolutionContext } = await loadEffectiveTree(
    clientId,
    firmId,
    source,
    {},
  );
  let mutated = applyMutations(effectiveTree, mutations);
  if (resolutionContext) {
    mutated = resolveTechniqueMutations(mutated, mutations, resolutionContext);
  }
  const mcPayload = await loadMonteCarloData(clientId, firmId, source, extraAccountMixes ?? [], mutated);
  const inputHash = hashMonteCarloInputs({
    tree: mutated,
    mcPayload,
    trials: CANONICAL_TRIALS,
  });

  if (!forceRefresh) {
    try {
      const [row] = await db
        .select()
        .from(solverMcCache)
        .where(
          and(
            eq(solverMcCache.clientId, clientId),
            eq(solverMcCache.inputHash, inputHash),
          ),
        );
      if (row) return { successRate: row.successRate };
    } catch (err) {
      console.error("solver_mc cache read failed; recomputing", err);
    }
  }

  const engine = createReturnEngine({
    indices: mcPayload.indices,
    correlation: mcPayload.correlation,
    seed: mcPayload.seed,
  });
  const accountMixes = new Map(
    mcPayload.accountMixes.map((a) => [a.accountId, a.mix]),
  );
  const raw = await runMonteCarlo({
    data: mutated,
    returnEngine: engine,
    accountMixes,
    trials: CANONICAL_TRIALS,
    requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
  });

  try {
    await db
      .insert(solverMcCache)
      .values({ firmId, clientId, inputHash, successRate: raw.successRate })
      .onConflictDoUpdate({
        target: [solverMcCache.clientId, solverMcCache.inputHash],
        set: { successRate: raw.successRate, computedAt: new Date() },
      });
    // Opportunistic age prune (bounded by the computed_at index).
    await db
      .delete(solverMcCache)
      .where(lt(solverMcCache.computedAt, new Date(Date.now() - PRUNE_AGE_MS)));
  } catch (err) {
    console.error("solver_mc cache write failed; returning fresh result", err);
  }

  return { successRate: raw.successRate };
}
