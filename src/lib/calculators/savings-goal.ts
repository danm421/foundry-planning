/**
 * Savings-goal projector for the client portal's calculator.
 *
 * Pure — no `@/db`, no `next/*`, no React — so it runs identically in a route
 * handler, in the browser between keystrokes, and in plain vitest. It sits
 * beside `debt-paydown.ts` rather than in `src/engine/`: this is a what-if the
 * client runs for themselves, and it must never become a dependency of the
 * projection.
 *
 * The model is one monthly loop, and the thing that makes it more than an
 * annuity formula is that THE GOAL MOVES. The balance compounds at the
 * client's expected return while the goal cost compounds at inflation, so
 * "have I got there yet" is a race between two growing series and has to be
 * asked index against matching index. Comparing a growing balance against a
 * frozen `targetToday` reads the goal reached 98 months early on the example
 * pinned in the tests — this is the bug the `targetSeries` exists to prevent.
 */

export interface SavingsGoalInput {
  /** Goal cost in TODAY's dollars. */
  targetToday: number;
  /** Months from now to the goal month. May be <= 0. */
  months: number;
  currentSavings: number;
  /** Nominal annual return, FRACTION. 0.06 is 6%. */
  annualReturn: number;
  /** Annual inflation applied to the goal cost, FRACTION. */
  inflationRate: number;
  monthlyContribution: number;
}

export interface SavingsGoalRun {
  /** The goal cost inflated to the goal month. */
  targetAtGoal: number;
  /** Balance at the end of each month; index 0 is today. Length months + 1. */
  balanceSeries: number[];
  /** The inflating goal cost, indexed to match `balanceSeries`. */
  targetSeries: number[];
  /** `balanceSeries[months]`. */
  projected: number;
  /** `projected / targetAtGoal`, clamped to 0..1. A zero-cost goal reads 1. */
  percentFunded: number;
  shortfall: number;
  surplus: number;
  totalContributed: number;
  /** `projected − currentSavings − totalContributed`. */
  growth: number;
  /**
   * Months from now the balance first overtakes the MOVING goal, searched
   * past the goal month out to `MAX_SAVINGS_MONTHS`. Null when it never does.
   * 0 means the client is already there today.
   */
  monthsToGoal: number | null;
}

/** 50 years — the same ceiling `debt-paydown.ts` and `loan-details.ts` use. */
export const MAX_SAVINGS_MONTHS = 600;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Months from `nowMonth`/`nowYear` to JANUARY of `targetYear`. Negative once
 * the target year is under way.
 *
 * January, not December, is deliberate: an earlier deadline yields a higher
 * required contribution, and erring toward saving more is the right direction
 * for a tool whose entire output is a savings target. The screen states the
 * month in words ("by Jan 2036") so the client is never guessing which it is.
 */
export function monthsToJanuary(
  nowYear: number,
  nowMonth: number,
  targetYear: number,
): number {
  return (targetYear - nowYear) * 12 - (nowMonth - 1);
}

export function projectSavings(input: SavingsGoalInput): SavingsGoalRun {
  const months = Math.max(0, Math.floor(input.months));
  const r = input.annualReturn / 12;
  const f = input.inflationRate / 12;

  const balanceSeries: number[] = [input.currentSavings];
  const targetSeries: number[] = [input.targetToday];

  let balance = input.currentSavings;
  let target = input.targetToday;
  for (let i = 0; i < months; i++) {
    // Grow, then contribute: an ordinary annuity, so this month's deposit
    // earns nothing this month. The conservative convention, and the one that
    // matches funding a goal out of a paycheque.
    balance = balance * (1 + r) + input.monthlyContribution;
    target = target * (1 + f);
    balanceSeries.push(balance);
    targetSeries.push(target);
  }

  const targetAtGoal = target;
  const projected = balance;
  const totalContributed = input.monthlyContribution * months;

  // A SEPARATE walk from the display series above, because it deliberately
  // runs PAST the goal month: a client who falls short should be told the
  // date they WOULD get there, which is the actionable half of the bad news.
  // Capping at the horizon could only ever return null or the horizon itself.
  let monthsToGoal: number | null = null;
  let b = input.currentSavings;
  let t = input.targetToday;
  if (b >= t) {
    monthsToGoal = 0;
  } else {
    for (let i = 1; i <= MAX_SAVINGS_MONTHS; i++) {
      b = b * (1 + r) + input.monthlyContribution;
      t = t * (1 + f);
      if (b >= t) {
        monthsToGoal = i;
        break;
      }
    }
  }

  return {
    targetAtGoal,
    balanceSeries,
    targetSeries,
    projected,
    // A zero-cost goal reads as fully funded rather than as NaN.
    percentFunded: targetAtGoal > 0 ? clamp01(projected / targetAtGoal) : 1,
    shortfall: Math.max(0, targetAtGoal - projected),
    surplus: Math.max(0, projected - targetAtGoal),
    totalContributed,
    growth: projected - input.currentSavings - totalContributed,
    monthsToGoal,
  };
}

/**
 * The monthly contribution that lands exactly on the goal.
 *
 * Closed-form, not a bisection: the horizon is fixed, so the goal's value at
 * the goal month is deterministic and the annuity inverts directly. (The debt
 * paydown's goal-seek needs a binary search because its simulator has no
 * closed form; this one does.)
 */
export function solveMonthlyForGoal(
  input: Omit<SavingsGoalInput, "monthlyContribution">,
): number {
  const months = Math.max(0, Math.floor(input.months));
  const r = input.annualReturn / 12;
  const f = input.inflationRate / 12;

  const targetAtGoal = input.targetToday * (1 + f) ** months;
  const fvLump = input.currentSavings * (1 + r) ** months;
  const gap = targetAtGoal - fvLump;

  // Already funded. Clamped rather than returned negative — "save −$40 a
  // month" is not a sentence, and the screen says "you're already there".
  if (gap <= 0) return 0;
  // The goal is due now: there is no annuity to spread it over. The caller
  // reads the outstanding lump sum from `projectSavings(...).shortfall` and
  // says so in words.
  if (months === 0) return 0;

  // At r = 0 the annuity factor ((1+r)^n − 1)/r is 0/0; it degenerates to n.
  const annuity = r > 0 ? ((1 + r) ** months - 1) / r : months;
  return gap / annuity;
}
