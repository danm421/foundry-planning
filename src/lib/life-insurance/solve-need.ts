import type { ClientData } from "@/engine/types";
import type { ProceedsRealization } from "@/engine/what-if/life-insurance-need";
import {
  runLifeInsuranceWhatIf,
  survivorEndingPortfolio,
} from "@/engine/what-if/life-insurance-need";
import { findRoot } from "./root-find";

export type { ProceedsRealization };

export interface LifeInsuranceAssumptions {
  deathYear: number;
  /** Deterministic blended growth rate for the LI proceeds. */
  proceedsGrowthRate: number;
  /** Realization mix — present when a model portfolio backs the proceeds. */
  proceedsRealization?: ProceedsRealization;
  leaveToHeirsAmount: number;
  livingExpenseAtDeath: number | null;
  payoffLiabilityIds: string[];
}

export interface NeedResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedEndingPortfolio: number;
}

/** Maximum face value the solver will try before declaring exceeds-cap. */
export const CAP = 20_000_000;

/** Lower clamp for the reference probe so a degenerate tiny seed can't produce
 *  a noisy slope. */
const MIN_REF_FACE = 1_000;

/** Bias a warm-start seed slightly high so the common case lands in the tight
 *  [0, ref] bracket (eRef >= target) and skips the CAP fallback probe. The
 *  bias only moves the reference probe location — never the converged root. */
const SEED_OVERSHOOT = 1.15;

/** The solver stops when the achieved portfolio is within 0.5% of the target. */
const TOLERANCE = 0.005;

/** Exported for tests — the relative tolerance the solver converges to. */
export const TOLERANCE_FOR_TEST = TOLERANCE;

/**
 * Solve for the minimum `faceValue` such that the
 * survivor's ending portfolio (liquid assets at their projected death year)
 * meets `a.leaveToHeirsAmount`.
 *
 * Returns:
 *   - `{ status: "solved", faceValue: 0 }` when the survivor already clears
 *     the target without any insurance (or target is 0).
 *   - `{ status: "solved", faceValue: N }` when N ∈ (0, CAP] satisfies the
 *     target within TOLERANCE.
 *   - `{ status: "exceeds-cap" }` when even CAP cannot meet the target.
 */
export function solveLifeInsuranceNeed(
  data: ClientData,
  deceased: "client" | "spouse",
  a: LifeInsuranceAssumptions,
  opts?: { atZero?: number; seedFace?: number },
): NeedResult {
  const ending = (faceValue: number): number =>
    survivorEndingPortfolio(
      runLifeInsuranceWhatIf({
        data,
        deceased,
        deathYear: a.deathYear,
        faceValue,
        proceedsGrowthRate: a.proceedsGrowthRate,
        proceedsRealization: a.proceedsRealization,
        livingExpenseAtDeath: a.livingExpenseAtDeath,
        payoffLiabilityIds: a.payoffLiabilityIds,
      }),
      deceased,
      data,
    );

  const target = a.leaveToHeirsAmount;

  // Face-0 anchor. Reuse a caller-supplied value (fused zero-projection) when
  // present, else probe it.
  const atZero = opts?.atZero ?? ending(0);
  if (atZero >= target) {
    return { status: "solved", faceValue: 0, achievedEndingPortfolio: atZero };
  }

  // Reference probe near the expected root. Seed from the previous year's
  // answer (warm start, biased slightly high) when available, else from the
  // shortfall. Clamp into [MIN_REF_FACE, CAP].
  const gap = target - atZero;
  const rawRef = opts?.seedFace && opts.seedFace > 0 ? opts.seedFace * SEED_OVERSHOOT : gap;
  const refFace = Math.min(CAP, Math.max(MIN_REF_FACE, rawRef));
  const eRef = ending(refFace);

  let lo: number;
  let flo: number;
  let hi: number;
  let fhi: number;
  if (eRef >= target) {
    // Root in (0, refFace]. Tight, locally-near-linear bracket.
    lo = 0; flo = atZero; hi = refFace; fhi = eRef;
  } else {
    // refFace still below the root — establish the upper bound at CAP.
    const atCap = ending(CAP);
    if (atCap < target) {
      return { status: "exceeds-cap", faceValue: CAP, achievedEndingPortfolio: atCap };
    }
    lo = refFace; flo = eRef; hi = CAP; fhi = atCap;
  }

  const root = findRoot(
    { lo, flo, hi, fhi, target, tol: target * TOLERANCE, maxIterations: 24 },
    ending,
  );

  return {
    status: "solved",
    faceValue: Math.round(root.x),
    achievedEndingPortfolio: root.fx,
  };
}
