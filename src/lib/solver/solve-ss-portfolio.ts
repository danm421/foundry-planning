// src/lib/solver/solve-ss-portfolio.ts
//
// Deterministic Social Security claim-age solve. Enumerates integer claim ages
// 62–70, runs the straight-line projection once per age (NO Monte Carlo), and
// returns the age that maximizes the final-year liquid portfolio
// (portfolioAssets.liquidTotal). Ties break toward the earliest age.
//
// Pure: takes the loaded tree as input; the route handler owns DB IO. Imports
// runProjection from the engine (lib→engine is allowed; no engine files change).

import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import { applyMutations } from "./apply-mutations";
import { leverSearchConfig } from "./lever-search-config";
import { resolveTechniqueMutations } from "./resolve-technique-mutations";
import type { EndingPortfolioSolveResult } from "./solve-types";
import type { SolverMutation, SolverPerson } from "./types";

export interface SolveSsPortfolioArgs {
  effectiveTree: ClientData;
  baselineMutations: SolverMutation[];
  person: SolverPerson;
  /** Re-resolve technique reinvestments in baseline mutations (mirrors solveTarget). */
  resolutionContext?: ResolutionContext;
  signal?: AbortSignal;
}

export function solveSsClaimAgeByPortfolio(
  args: SolveSsPortfolioArgs,
): EndingPortfolioSolveResult {
  // Resolve the age range against the post-baseline tree — single source of
  // truth with the PoS solve's config (currently 62–70, step 1).
  const searchTree = applyMutations(args.effectiveTree, args.baselineMutations);
  const config = leverSearchConfig(
    { kind: "ss-claim-age", person: args.person },
    searchTree,
  );

  const candidates: { value: number; endingPortfolio: number }[] = [];
  let bestAge = config.lo;
  let bestEnding = -Infinity;
  let bestProjection: ProjectionYear[] | null = null;

  for (let age = config.lo; age <= config.hi; age += config.step) {
    if (args.signal?.aborted) throw new Error("aborted");

    const allMutations: SolverMutation[] = [
      ...args.baselineMutations,
      // Force `years` mode so the candidate age takes effect even when the row
      // is in FRA / at-retirement mode (otherwise every age projects identically).
      { kind: "ss-claim-age-mode", person: args.person, mode: "years" },
      { kind: "ss-claim-age", person: args.person, age },
    ];
    let tree = applyMutations(args.effectiveTree, allMutations);
    if (args.resolutionContext) {
      tree = resolveTechniqueMutations(tree, allMutations, args.resolutionContext);
    }

    const projection = runProjection(tree);
    const ending =
      projection[projection.length - 1].portfolioAssets.liquidTotal;
    candidates.push({ value: age, endingPortfolio: ending });

    // Strict `>` keeps the EARLIEST age on ties.
    if (ending > bestEnding) {
      bestEnding = ending;
      bestAge = age;
      bestProjection = projection;
    }
  }

  return {
    objective: "ending-portfolio",
    status: "converged",
    solvedValue: bestAge,
    endingPortfolio: bestEnding,
    candidates,
    finalProjection: bestProjection!,
  };
}
