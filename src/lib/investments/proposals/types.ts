import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";

// ── Fees ────────────────────────────────────────────────────────────────────

export interface FeeHolding {
  marketValue: number;
  /** Decimal fraction; null means unknown, never free. */
  expenseRatio: number | null;
}

export interface FeeComparison {
  currentBlendedEr: number | null;
  proposedBlendedEr: number | null;
  currentCoveragePct: number;
  proposedCoveragePct: number;
  advisoryFeeCurrent: number | null;
  advisoryFeeProposed: number | null;
  /** Fund cost + advisory fee, in dollars per year. Null when the blend is suppressed. */
  annualDollarsCurrent: number | null;
  annualDollarsProposed: number | null;
  /** current − proposed; POSITIVE means the proposal is cheaper. */
  annualDollarsSaved: number | null;
}

// ── Suitability ─────────────────────────────────────────────────────────────

export const RISK_LEVELS = [
  "conservative",
  "moderately_conservative",
  "moderate",
  "moderately_aggressive",
  "aggressive",
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface RungPortfolio {
  level: RiskLevel;
  volatility: number;
}

export interface Placement {
  level: RiskLevel;
  /** True when the rung was inferred from volatility rather than read from a tag. */
  estimated: boolean;
}

export interface SuitabilitySnapshot {
  clientLevel: RiskLevel | null;
  clientScore: number | null;
  bindingConstraint: "tolerance" | "capacity" | "none";
  confirmedAt: string | null;
  currentPlacement: Placement | null;
  proposedPlacement: Placement | null;
  currentExceedsProfile: boolean;
  proposedMatchesProfile: boolean;
}

// ── Backtest & stress ───────────────────────────────────────────────────────

export interface BacktestPoint {
  date: string;
  value: number;
}

export interface BacktestSeries {
  windowStart: string;
  windowEnd: string;
  nMonths: number;
  startValue: number;
  current: BacktestPoint[];
  proposed: BacktestPoint[];
  endingCurrent: number;
  endingProposed: number;
}

export interface StressWindow {
  key: string;
  label: string;
  start: string; // YYYY-MM
  end: string;   // YYYY-MM
  available: boolean;
  /** Populated only when `available` is false. */
  unavailableReason: string | null;
  currentReturn: number | null;
  proposedReturn: number | null;
  currentDrawdown: number | null;
  proposedDrawdown: number | null;
  currentDollars: number | null;
  proposedDollars: number | null;
}

// ── Outcomes ────────────────────────────────────────────────────────────────

export interface OutcomeRow {
  years: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface OutcomeCone {
  startValue: number;
  current: OutcomeRow[];
  proposed: OutcomeRow[];
}

// ── Break-even ──────────────────────────────────────────────────────────────

export type BreakEvenVerdict =
  | "recovered"
  | "beyond_horizon"
  | "no_benefit"
  | "no_tax_cost";

export interface BreakEvenResult {
  estimatedTax: number;
  annualBenefit: number;
  /** Null unless the verdict is "recovered" or "beyond_horizon". */
  years: number | null;
  verdict: BreakEvenVerdict;
}

// ── The frozen artifact ─────────────────────────────────────────────────────

export interface ProposedHolding {
  ticker: string;
  name: string | null;
  weight: number;
  expenseRatio: number | null;
}

export interface ProposalSnapshot {
  /** Bump only alongside a reader that still handles every earlier value. */
  version: 1;
  computedAt: string;
  compute: RebalanceComputeResult;
  fees: FeeComparison;
  suitability: SuitabilitySnapshot;
  backtest: BacktestSeries | null;
  stress: StressWindow[];
  outcomes: OutcomeCone;
  breakEven: BreakEvenResult;
  targetHoldings: ProposedHolding[];
}
