// src/lib/solver/solve-funding.ts
//
// Deterministic full-funding goal-seek. Bisects a single lever to the minimum
// change that makes the projection fully funded (fundingScore >= 1), using
// runProjection only — no Monte Carlo. Mirrors solve-target.ts.
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import { fundingScore } from "@/lib/analysis/retirement-funding-score";
import { applyMutations } from "./apply-mutations";
import { bisect } from "./bisect";
import {
  buildLeverMutation,
  leverSearchConfig,
  type LeverSearchConfig,
} from "./lever-search-config";
import { resolveTechniqueMutations } from "./resolve-technique-mutations";
import type { SolveLeverKey } from "./solve-types";
import type { SolverMutation } from "./types";

export interface SolveFundingResult {
  status: "converged" | "unreachable" | "max-iterations";
  solvedValue: number;
  finalProjection: ProjectionYear[];
}

export interface SolveFundingArgs {
  effectiveTree: ClientData;
  baselineMutations: SolverMutation[];
  target: SolveLeverKey;
  resolutionContext?: ResolutionContext;
  signal?: AbortSignal;
  /** Test seam: override the projector. Defaults to runProjection. */
  project?: (value: number) => ProjectionYear[];
  /** Test seam: override the lever search bounds. */
  leverConfigOverride?: LeverSearchConfig;
}

export async function solveFunding(args: SolveFundingArgs): Promise<SolveFundingResult> {
  const config = args.leverConfigOverride ?? leverSearchConfig(args.target, args.effectiveTree);

  const project =
    args.project ??
    ((value: number) => {
      const all = [
        ...args.baselineMutations,
        buildLeverMutation(args.target, value, args.effectiveTree),
      ];
      let tree = applyMutations(args.effectiveTree, all);
      if (args.resolutionContext) {
        tree = resolveTechniqueMutations(tree, all, args.resolutionContext);
      }
      return runProjection(tree);
    });

  let lastValue: number | null = null;
  let lastProjection: ProjectionYear[] | null = null;

  const evaluate = async (value: number): Promise<number> => {
    if (args.signal?.aborted) throw new Error("aborted");
    const projection = project(value);
    lastValue = value;
    lastProjection = projection;
    return fundingScore(projection);
  };

  const result = await bisect({
    lo: config.lo,
    hi: config.hi,
    step: config.step,
    direction: config.direction,
    target: 1.0,        // fundingScore === 1.0 at the fully-funded boundary
    tolerance: 0,       // no early-exit: converge via bracket-collapse to the
                        // minimal funded lever (bisect always returns the
                        // funded "tight" side, so the result is truly funded)
    maxIterations: 24,  // enough to narrow the widest lever range by its step
    evaluate,
  });

  if (lastValue !== result.solvedValue || lastProjection === null) {
    await evaluate(result.solvedValue);
  }

  return {
    status: result.status,
    solvedValue: result.solvedValue,
    finalProjection: lastProjection!,
  };
}
