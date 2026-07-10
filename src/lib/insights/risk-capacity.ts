/** Financial ability to absorb loss, distilled from planning data. */
export interface CapacityInputs {
  /** Years from today to plan end (planEndAge - currentAge). */
  horizonYears: number;
  /** fundingScore(projection): 1.0 = funded boundary, >1 surplus, <1 shortfall. */
  fundingScore: number;
  /** Avg annual real net withdrawal / starting liquid assets (0..~0.1). */
  withdrawalRate: number;
  /** (SS + pension) / total spending in first retirement year (0..1+). */
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

/** Capacity factor weights — tunable. Must sum to 1. */
export const CAPACITY_WEIGHTS = {
  horizon: 0.3,
  buffer: 0.3,
  withdrawal: 0.2,
  incomeFloor: 0.2,
} as const;

/** ± band (in growth-exposure points) inside which markers count as aligned. */
export const VERDICT_TOLERANCE_PCT = 5;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function computeCapacityScore(i: CapacityInputs): number {
  const horizonFactor = clamp01(i.horizonYears / 30); // 30+ yrs → full
  const bufferFactor = clamp01((i.fundingScore - 0.8) / 0.7); // 0.8→0, 1.5→1
  const withdrawalFactor = clamp01(1 - i.withdrawalRate / 0.06); // 0%→1, 6%→0
  const incomeFloorFactor = clamp01(i.guaranteedIncomeCoverage); // 100%+→1
  const score =
    CAPACITY_WEIGHTS.horizon * horizonFactor +
    CAPACITY_WEIGHTS.buffer * bufferFactor +
    CAPACITY_WEIGHTS.withdrawal * withdrawalFactor +
    CAPACITY_WEIGHTS.incomeFloor * incomeFloorFactor;
  return Math.round(score * 100);
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
