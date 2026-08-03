/**
 * Financial ability to absorb loss, distilled from planning data.
 *
 * Time enters as TWO clocks, not one, because they answer different questions
 * and a household can be rich in one and bankrupt in the other:
 *
 *  - `yearsToRetirement` — how long until the portfolio must start paying out.
 *    This is the sequence-of-returns window. Twenty years out, a crash is
 *    something you contribute into; seven years out, it moves the retirement
 *    date. A single lifetime horizon (plan end minus today) hides this
 *    entirely: it scored a 58-year-old seven years from retiring the same as a
 *    38-year-old, because both had ~35 years to plan end.
 *
 *  - `retirementYears` — how long the payout is spread over. Money that will
 *    not be spent for another two decades still has time to recover, which is
 *    what separates a 66-year-old from an 88-year-old once the first clock has
 *    run out. The *burden* of a long retirement is not double-counted here; it
 *    already shows up in `withdrawalRate` and `fundingScore`.
 */
export interface CapacityInputs {
  /** Years from today until retirement (retirementAge - currentAge, floored at 0). */
  yearsToRetirement: number;
  /** Years the portfolio is drawn down over (planEndAge - retirementAge, floored at 0). */
  retirementYears: number;
  /** fundingScore(projection): 1.0 = funded boundary, >1 surplus, <1 shortfall. */
  fundingScore: number;
  /** Avg annual real net withdrawal / starting liquid assets (0..~0.1). */
  withdrawalRate: number;
  /** (SS + pension) / spending across the retirement years they are paid (0..1+). */
  guaranteedIncomeCoverage: number;
}

/** Inputs to derive the growth allocation the goals demand. */
export interface RequiredInputs {
  startingLiquidAssets: number;
  avgAnnualRealNetWithdrawal: number;
  horizonYears: number;
  /** Real geometric returns from firm CMA. */
  cashReturn: number;
  equityReturn: number;
}

export type Verdict =
  | "aligned"
  | "over_risked"
  | "under_risked"
  | "goals_over_reaching";

export interface RiskAlignment {
  currentPct: number;
  requiredPct: number;
  capacityPct: number;
  capacityScore: number;
  verdict: Verdict;
}

/**
 * Capacity factor weights — tunable. These sum to 1.43, NOT 1, and that is
 * deliberate: `computeCapacityScore` caps the total at 100, so the plan has
 * headroom in which strength in one area can offset weakness in another.
 * Because `computeProfile` takes `min(tolerance, capacity)`, a capacity score
 * held down by a factor that does not actually constrain the household caps
 * their entire composite risk profile — so the headroom is not cosmetic.
 *
 * **Two independent routes to high capacity.** Capacity is the ability to
 * absorb a loss, and there are two unrelated ways to have it:
 *
 *  1. `runway` (0.50) — you will not touch the money for decades, so a
 *     drawdown is something you contribute into rather than realise.
 *  2. `incomeFloor` (0.45) — Social Security and pensions already cover the
 *     spending, so the portfolio is discretionary and a drawdown never forces
 *     a sale. This holds *regardless of age*: a fully-floored 75-year-old has
 *     real capacity that no horizon term will ever credit them with.
 *
 * Either route alone carries an otherwise ordinary household to roughly 90.
 * That is the design, not an artifact — the two are near-substitutes, so the
 * weights are near-equal and both are large.
 *
 * The floor sits a shade under runway (0.48 vs 0.50) rather than at exact
 * parity, for one reason: coverage is measured against *planned* spending,
 * and planned spending is the softer of the two numbers — healthcare and
 * long-term care can lift it late, and the benefit side carries legislative
 * risk that a calendar does not. Time is the harder guarantee. The gap also
 * keeps the cap honest: both heavyweights maxed reach 98, not 100, so the
 * supporting factors are never fully decorative.
 *
 * The remaining three (`retirementHorizon`, `withdrawal`, `buffer`, 0.15 each)
 * are supporting evidence. They cannot manufacture capacity on their own: all
 * three maxed with no runway and no floor reach only 45.
 */
export const CAPACITY_WEIGHTS = {
  runway: 0.5,
  incomeFloor: 0.48,
  retirementHorizon: 0.15,
  withdrawal: 0.15,
  buffer: 0.15,
} as const;

/**
 * Years to retirement at which the runway factor saturates. Twenty is the
 * point past which a portfolio has reliably outlived any drawdown in the
 * historical record, and it is the number that makes "20+ years out" and
 * "7 years out" score like the different situations they are.
 */
export const CAPACITY_RUNWAY_FULL_YEARS = 20;

/**
 * Length of retirement at which the second clock saturates. This is the term
 * that keeps an already-retired household from collapsing to zero time credit
 * — a 30-year retirement still has decades of unspent money in it.
 */
export const CAPACITY_RETIREMENT_FULL_YEARS = 25;

/** Ceiling on the blended score. Weights deliberately overfund it — see above. */
export const CAPACITY_SCORE_MAX = 100;

/** ± band (in growth-exposure points) inside which markers count as aligned. */
export const VERDICT_TOLERANCE_PCT = 5;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The five weighted contributions computeCapacityScore blends, exposed
 * separately so the risk-profile detail page can show the breakdown of WHY
 * capacity is what it is -- without a second, drift-prone copy of these
 * curves living in `src/lib/risk/capacity.ts`. computeCapacityScore is
 * defined in terms of this function.
 */
export interface CapacityFactors {
  runway: number;
  incomeFloor: number;
  retirementHorizon: number;
  withdrawal: number;
  buffer: number;
}

export function capacityFactors(i: CapacityInputs): CapacityFactors {
  return {
    runway:
      CAPACITY_WEIGHTS.runway *
      clamp01(i.yearsToRetirement / CAPACITY_RUNWAY_FULL_YEARS), // 20+ yrs → full
    incomeFloor:
      CAPACITY_WEIGHTS.incomeFloor * clamp01(i.guaranteedIncomeCoverage), // 100%+→1
    retirementHorizon:
      CAPACITY_WEIGHTS.retirementHorizon *
      clamp01(i.retirementYears / CAPACITY_RETIREMENT_FULL_YEARS), // 25+ yrs → full
    withdrawal:
      CAPACITY_WEIGHTS.withdrawal * clamp01(1 - i.withdrawalRate / 0.06), // 0%→1, 6%→0
    buffer: CAPACITY_WEIGHTS.buffer * clamp01((i.fundingScore - 0.8) / 0.7), // 0.8→0, 1.5→1
  };
}

export function computeCapacityScore(i: CapacityInputs): number {
  // The weights sum to 1.43, so the raw blend runs to 143. Capping here (rather
  // than normalising the weights back to 1) is what buys the offsetting
  // behaviour: below the cap every factor still moves the score one-for-one,
  // and only a household already at 100 stops feeling further gains.
  const f = capacityFactors(i);
  const score =
    f.runway + f.incomeFloor + f.retirementHorizon + f.withdrawal + f.buffer;
  return Math.min(CAPACITY_SCORE_MAX, Math.round(score * 100));
}

/** Present value of a level real withdrawal W over N years at rate r. */
function annuityPV(w: number, r: number, n: number): number {
  if (n <= 0 || w <= 0) return 0;
  if (Math.abs(r) < 1e-9) return w * n; // r≈0 → undiscounted
  return (w * (1 - Math.pow(1 + r, -n))) / r;
}

/**
 * Real return r such that starting liquid assets exactly fund N years of
 * withdrawal W (annuity-exhaustion). Bisection over [-0.05, 0.20]. Monotonic:
 * higher r → lower PV of withdrawals, so we search for annuityPV(W,r,N) == A.
 */
export function solveRequiredReturn(
  startingLiquidAssets: number,
  avgAnnualRealNetWithdrawal: number,
  horizonYears: number,
): number {
  const A = startingLiquidAssets;
  const W = avgAnnualRealNetWithdrawal;
  const N = horizonYears;
  if (W <= 0) return -0.05; // no withdrawals → no growth needed (floor)
  // f(r) = annuityPV(W,r,N) - A ; decreasing in r. Find root.
  let lo = -0.05;
  let hi = 0.2;
  const f = (r: number) => annuityPV(W, r, N) - A;
  if (f(lo) < 0) return lo; // even at lowest r, assets already cover
  if (f(hi) > 0) return hi; // even at highest r, assets fall short
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Linearly interpolate a required real return onto a 0..100 growth axis. */
export function impliedGrowthPct(
  requiredReturn: number,
  cashReturn: number,
  equityReturn: number,
): number {
  const span = equityReturn - cashReturn;
  if (span <= 0) return requiredReturn > cashReturn ? 100 : 0;
  const frac = (requiredReturn - cashReturn) / span;
  return Math.round(clamp01(frac) * 100);
}

export function computeRequiredGrowthPct(i: RequiredInputs): number {
  const r = solveRequiredReturn(
    i.startingLiquidAssets,
    i.avgAnnualRealNetWithdrawal,
    i.horizonYears,
  );
  return impliedGrowthPct(r, i.cashReturn, i.equityReturn);
}

export function computeVerdict(a: {
  currentPct: number;
  requiredPct: number;
  capacityPct: number;
}): Verdict {
  const b = VERDICT_TOLERANCE_PCT;
  // Structural conflict first: goals demand more risk than capacity supports.
  if (a.requiredPct > a.capacityPct + b) return "goals_over_reaching";
  if (a.currentPct > a.capacityPct + b) return "over_risked";
  if (a.currentPct < a.requiredPct - b) return "under_risked";
  return "aligned";
}

export function assembleRiskAlignment(args: {
  currentPct: number;
  capacity: CapacityInputs;
  required: RequiredInputs;
}): RiskAlignment {
  const capacityScore = computeCapacityScore(args.capacity);
  const capacityPct = capacityScore; // v1: 1:1 map (tunable)
  const requiredPct = computeRequiredGrowthPct(args.required);
  const currentPct = Math.round(args.currentPct);
  return {
    currentPct,
    requiredPct,
    capacityPct,
    capacityScore,
    verdict: computeVerdict({ currentPct, requiredPct, capacityPct }),
  };
}
