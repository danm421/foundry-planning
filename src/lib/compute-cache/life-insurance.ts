// src/lib/compute-cache/life-insurance.ts
//
// Cache helper for the Life Insurance Summary pre-solve. Mirrors the combined
// over-time + solve-mc SSE routes server-side and assembles the same `LiSolved`
// payload the launcher's `useLiPresolve` produces, so a cached deck render is
// byte-identical to a freshly solved one.
//
// Sibling of `getOrComputeMonteCarlo` (monte-carlo.ts): resolve scenario id,
// load tree + MC payload, hash, read-through cache (graceful degradation),
// recompute, upsert (graceful degradation).
import { resolveScenarioId } from "./resolve-scenario-id";
import { withComputeCache } from "./cache-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { computeNeedOverTime, hasSpouse } from "@/lib/life-insurance/need-over-time";
import { solveLifeInsuranceNeedMc } from "@/lib/life-insurance/solve-need-mc";
import { computeEstateTaxAddend } from "@/lib/life-insurance/estate-tax-addend";
import {
  loadLiProceedsGrowth,
  DEFAULT_LI_GROWTH,
  type LiProceedsGrowth,
} from "@/lib/life-insurance/load-li-portfolio";
import { SYNTHETIC_POLICY_ID } from "@/engine/what-if/life-insurance-need";
import type { LifeInsuranceAssumptions } from "@/lib/life-insurance/solve-need";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { LiSolved } from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { ClientData } from "@/engine/types";
import { hashLifeInsuranceInputs } from "./hash";

/** Production Monte Carlo trial count — matches `DEFAULT_TRIALS` in
 *  solve-need-mc.ts, the value the live solve-mc route uses. Exported so the
 *  live solver-summary route solves at the same trial count. */
export const CANONICAL_TRIALS = 250;

/**
 * Pure `LiSolved` producer: the over-time curve + client/spouse Monte Carlo
 * solve + estate-tax addend, assembled exactly as `useLiPresolve.solveScenario`
 * does. Shared by the cached scenario path (`getOrComputeLifeInsuranceSolve`)
 * and the live solver-summary route (which solves the working tree directly,
 * uncached — unsaved mutations change the tree per edit).
 *
 * `mcPayload.requiredMinimumAssetLevel` is mutated per case; callers pass a
 * freshly loaded payload so the mutation is local.
 */
export async function computeLiSolved(args: {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  proceeds: LiProceedsGrowth;
  assumptions: LiAssumptions;
  modelPortfolioLabel: string;
  trials: number;
}): Promise<LiSolved> {
  const { tree, mcPayload, proceeds, assumptions, modelPortfolioLabel, trials } = args;

  // 1) Over-time curve (deterministic straight-line solve, one row per plan
  //    year). Same assumptions shape the over-time route builds.
  const overTimeAssumptions: Omit<LifeInsuranceAssumptions, "deathYear"> = {
    proceedsGrowthRate: proceeds.rate,
    proceedsRealization: proceeds.realization,
    leaveToHeirsAmount: assumptions.leaveToHeirsAmount,
    livingExpenseAtDeath: assumptions.livingExpenseAtDeath,
    payoffLiabilityIds: assumptions.payoffLiabilityIds,
  };
  const rows = computeNeedOverTime(
    tree,
    overTimeAssumptions,
    assumptions.coverEstateTaxes,
  );
  // The launcher maps rows down to { year, clientNeed, spouseNeed } (it drops
  // the status fields); reproduce that projection field-for-field.
  const curveRows: LiSolved["curveRows"] = rows.map((x) => ({
    year: x.year,
    clientNeed: x.clientNeed,
    spouseNeed: x.spouseNeed,
  }));

  // 2) Monte Carlo solve. Mirror solve-mc route: build the solve assumptions,
  //    detect spouse via hasSpouse, fold each per-case estate-tax addend into
  //    requiredMinimumAssetLevel before that case's solve.
  const solveAssumptions: LifeInsuranceAssumptions & { mcTargetScore: number } = {
    deathYear: assumptions.deathYear,
    proceedsGrowthRate: proceeds.rate,
    proceedsRealization: proceeds.realization,
    leaveToHeirsAmount: assumptions.leaveToHeirsAmount,
    livingExpenseAtDeath: assumptions.livingExpenseAtDeath,
    payoffLiabilityIds: assumptions.payoffLiabilityIds,
    mcTargetScore: assumptions.mcTargetScore,
  };

  const isMarried = hasSpouse(tree);

  const clientAddend = assumptions.coverEstateTaxes
    ? computeEstateTaxAddend(tree, "client", solveAssumptions)
    : 0;
  const spouseAddend =
    assumptions.coverEstateTaxes && isMarried
      ? computeEstateTaxAddend(tree, "spouse", solveAssumptions)
      : 0;

  mcPayload.requiredMinimumAssetLevel =
    assumptions.leaveToHeirsAmount + clientAddend;
  const clientResult = await solveLifeInsuranceNeedMc(
    tree,
    "client",
    solveAssumptions,
    mcPayload,
    { trials },
  );

  let mcSpouse: LiSolved["mcSpouse"] = null;
  if (isMarried) {
    mcPayload.requiredMinimumAssetLevel =
      assumptions.leaveToHeirsAmount + spouseAddend;
    const spouseResult = await solveLifeInsuranceNeedMc(
      tree,
      "spouse",
      solveAssumptions,
      mcPayload,
      { trials },
    );
    mcSpouse = {
      status: spouseResult.status,
      faceValue: spouseResult.faceValue,
      achievedScore: spouseResult.achievedScore,
    };
  }

  // Assemble the LiSolved exactly as `useLiPresolve.solveScenario` does: the
  // MC results are narrowed to { status, faceValue, achievedScore } (iterations
  // and estateTaxAddend are dropped), and assumptions carries only deathYear,
  // modelPortfolioLabel, mcTargetScore.
  return {
    curveRows,
    mcClient: {
      status: clientResult.status,
      faceValue: clientResult.faceValue,
      achievedScore: clientResult.achievedScore,
    },
    mcSpouse,
    assumptions: {
      deathYear: assumptions.deathYear,
      modelPortfolioLabel,
      mcTargetScore: assumptions.mcTargetScore,
    },
  };
}

export async function getOrComputeLifeInsuranceSolve(args: {
  clientId: string;
  firmId: string;
  scenarioId: string | "base";
  assumptions: LiAssumptions;
  /** Display label for the resolved model portfolio — carried verbatim into
   *  `LiSolved.assumptions.modelPortfolioLabel`, exactly as the launcher passes
   *  it through `useLiPresolve.solveScenario`. */
  modelPortfolioLabel: string;
  forceRefresh?: boolean;
}): Promise<LiSolved> {
  const realScenarioId = await resolveScenarioId(args.clientId, args.scenarioId);

  // Mirror the over-time + solve-mc routes:
  //  - over-time loads the effective tree and `loadLiProceedsGrowth`.
  //  - solve-mc loads the effective tree, the same proceeds, and the MC payload
  //    with the synthetic-policy mix injected (NO effectiveTree passed — the
  //    live route omits it, so the in-estate liquid set + startingLiquidBalance
  //    stay base-sourced; reproduce that exactly for shape fidelity).
  const [{ effectiveTree }, proceeds] = await Promise.all([
    loadEffectiveTree(args.clientId, args.firmId, args.scenarioId, {}),
    loadLiProceedsGrowth(
      args.firmId,
      args.assumptions.modelPortfolioId,
      DEFAULT_LI_GROWTH,
    ),
  ]);
  const mcPayload = await loadMonteCarloData(args.clientId, args.firmId, args.scenarioId, [
    { accountId: SYNTHETIC_POLICY_ID, mix: proceeds.mix },
  ]);

  const inputHash = hashLifeInsuranceInputs({
    tree: effectiveTree,
    mcPayload,
    assumptions: args.assumptions,
  });

  return withComputeCache<LiSolved>({
    firmId: args.firmId,
    clientId: args.clientId,
    realScenarioId,
    kind: "life_insurance_solve",
    inputHash,
    trials: CANONICAL_TRIALS,
    forceRefresh: args.forceRefresh,
    label: "life_insurance_solve",
    compute: async () =>
      computeLiSolved({
        tree: effectiveTree,
        mcPayload,
        proceeds,
        assumptions: args.assumptions,
        modelPortfolioLabel: args.modelPortfolioLabel,
        trials: CANONICAL_TRIALS,
      }),
  });
}
