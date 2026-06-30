// src/lib/solver/refine-on-grid.ts
//
// Phase 2 of the two-phase max-spend solve. The cheap 250-trial bisection
// (phase 1) localizes the answer to within a couple of $5k steps; refineOnGrid
// re-selects on the $5k grid using a HIGHER trial count (500), walking outward
// from the localized value until it brackets the target PoS, then returns the
// grid step whose PoS is closest to the target.
//
// Why a separate phase: every MC trial is seeded by its index, so an N-trial run
// is the literal first-N prefix of a larger run. The 250-trial search can sit on
// a non-representative prefix and systematically under/over-shoot. Re-selecting
// at 500 trials cuts that error without paying for a full 1000-trial finalize.
// The ~±1-step residual vs the 1000-trial report is an accepted tradeoff — see
// specs/2026-06-30-solver-maxspend-accuracy-design.md.

export interface RefineOnGridInput {
  /** Localized starting value from phase 1, already on the `step` grid. */
  start: number;
  /** Grid step (dollars), e.g. 5000. */
  step: number;
  /** +1 if PoS increases with value, -1 if PoS decreases with value. */
  direction: 1 | -1;
  /** Target PoS in (0, 1). */
  target: number;
  /** Max grid steps to walk from `start` before giving up. Default 6. */
  maxSteps?: number;
  /** Lower bound on value, inclusive. Default 0. */
  min?: number;
  /** Upper bound on value, inclusive. Default +Infinity. */
  max?: number;
  /** PoS at `value`, evaluated at the refine trial count. */
  evaluate: (value: number) => Promise<number>;
}

export interface RefineOnGridResult {
  solvedValue: number;
  achievedPoS: number;
  /** "converged" if the walk bracketed the target; "capped" if it hit maxSteps
   *  or a bound first (still returns the closest value seen). */
  status: "converged" | "capped";
}

export async function refineOnGrid(input: RefineOnGridInput): Promise<RefineOnGridResult> {
  const { start, step, direction, target, evaluate } = input;
  const maxSteps = input.maxSteps ?? 6;
  const min = input.min ?? 0;
  const max = input.max ?? Number.POSITIVE_INFINITY;

  // Track the closest-to-target value seen across the walk.
  let bestValue = start;
  let bestPoS = await evaluate(start);
  let bestDist = Math.abs(bestPoS - target);

  const consider = (value: number, pos: number) => {
    const dist = Math.abs(pos - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestValue = value;
      bestPoS = pos;
    }
  };

  if (bestPoS === target) {
    return { solvedValue: start, achievedPoS: bestPoS, status: "converged" };
  }

  // Walk the direction that moves PoS toward the target:
  //   PoS too HIGH → lower it: value moves by -direction.
  //   PoS too LOW  → raise it: value moves by +direction.
  const startAbove = bestPoS > target;
  const stepSign = startAbove ? -direction : direction;

  let value = start;
  let status: "converged" | "capped" = "capped";
  for (let i = 0; i < maxSteps; i++) {
    const next = value + stepSign * step;
    if (next < min || next > max) break; // hit a bound — keep best seen
    value = next;
    const pos = await evaluate(value);
    consider(value, pos);
    // Bracketed once PoS crosses to the other side of the target.
    if (pos === target || pos > target !== startAbove) {
      status = "converged";
      break;
    }
  }

  return { solvedValue: bestValue, achievedPoS: bestPoS, status };
}
