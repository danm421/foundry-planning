import type { ClientData } from "@/engine/types";
import {
  runLifeInsuranceWhatIf,
  survivorEndingPortfolio,
} from "@/engine/what-if/life-insurance-need";

export interface LifeInsuranceAssumptions {
  deathYear: number;
  growthRate: number;
  leaveToHeirsAmount: number;
  finalExpenses: number;
  livingExpenseAtDeath: number | null;
  payOffDebtsAtDeath: boolean;
}

export interface NeedResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedEndingPortfolio: number;
}

/** Maximum face value the solver will try before declaring exceeds-cap. */
const CAP = 20_000_000;

/** Bisection stops when the achieved portfolio is within 0.5% of the target. */
const TOLERANCE = 0.005;

/**
 * Bisect on `faceValue` to find the minimum death benefit such that the
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
        growthRate: a.growthRate,
        finalExpenses: a.finalExpenses,
        livingExpenseAtDeath: a.livingExpenseAtDeath,
        payOffDebtsAtDeath: a.payOffDebtsAtDeath,
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

  // Binary search for the minimum face value that satisfies the target.
  let lo = 0;
  let hi = CAP;
  let mid = hi;
  let achieved = atCap;
  for (let i = 0; i < 24; i++) {
    mid = (lo + hi) / 2;
    achieved = ending(mid);
    if (Math.abs(achieved - target) <= target * TOLERANCE) break;
    if (achieved < target) lo = mid;
    else hi = mid;
  }

  return { status: "solved", faceValue: Math.round(mid), achievedEndingPortfolio: achieved };
}
