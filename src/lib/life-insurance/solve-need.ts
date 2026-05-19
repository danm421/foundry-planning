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
const CAP = 20_000_000;

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

  // If the survivor already meets the target at $0 face value (or target is 0),
  // no insurance is needed.
  const atZero = ending(0);
  if (atZero >= target) {
    return { status: "solved", faceValue: 0, achievedEndingPortfolio: atZero };
  }

  // If even the CAP cannot reach the target, the need exceeds our search range.
  const atCap = ending(CAP);
  if (atCap < target) {
    return { status: "exceeds-cap", faceValue: CAP, achievedEndingPortfolio: atCap };
  }

  // Bracket is valid: atZero < target <= atCap (guaranteed by the two early
  // returns above). Solve for the minimum face value via Illinois-modified
  // false position -- converges in ~4-6 probes vs bisection's ~24.
  const root = findRoot(
    {
      lo: 0,
      flo: atZero,
      hi: CAP,
      fhi: atCap,
      target,
      tol: target * TOLERANCE,
      maxIterations: 24,
    },
    ending,
  );

  return {
    status: "solved",
    faceValue: Math.round(root.x),
    achievedEndingPortfolio: root.fx,
  };
}
