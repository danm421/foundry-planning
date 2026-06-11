import type { PortfolioStats } from "@/lib/portfolio-stats";
import type { RiskReturnStats } from "@/lib/investments/portfolio-stats";

/** One asset-class weight with a human label. */
export interface NamedWeight {
  assetClassId: string;
  name: string;
  weight: number; // 0..1
}

/** Per-asset-class delta row (target − current). */
export interface DeltaRow {
  assetClassId: string;
  name: string;
  currentPct: number; // 0..1
  targetPct: number; // 0..1
  diffPct: number; // targetPct − currentPct
}

/** One side of the comparison (current holdings OR proposed fund portfolio). */
export interface PortfolioSide {
  totalValue: number;
  assetMix: NamedWeight[];
  /** Realized backtest stats over the common window; null when insufficient history. */
  realized: PortfolioStats | null;
  /** Forward-looking CMA expected stats. */
  cma: RiskReturnStats;
  /** Share of totalValue covered by classified securities with price history (1 for a fund portfolio with full coverage). */
  coveragePct: number;
}

/** Net buy/sell to move current → target, rolled up by asset class. */
export interface TradeRow {
  assetClassId: string;
  name: string;
  currentValue: number;
  targetValue: number;
  deltaValue: number; // targetValue − currentValue (positive = buy)
  action: "buy" | "sell" | "hold";
}

export interface TaxEstimate {
  taxableMarketValue: number;
  taxableCostBasis: number;
  realizedGain: number; // marketValue − costBasis across taxable liquidated holdings
  effectiveRate: number; // 0..1
  rateSource: "engine" | "override";
  estimatedTax: number; // max(0, realizedGain) × effectiveRate
  notes: string[];
}

export interface RealizedWindow {
  windowStart: string | null;
  windowEnd: string | null;
  nMonths: number;
  insufficientHistory: boolean; // common window below MIN_MONTHS
  shortHistory: boolean; // below WARN_MONTHS
}

export interface RebalanceComputeResult {
  current: PortfolioSide;
  proposed: PortfolioSide;
  assetMixDelta: DeltaRow[];
  tradeSummary: TradeRow[];
  tax: TaxEstimate;
  realizedWindow: RealizedWindow;
}

/** Request body for POST /api/clients/[id]/rebalance/compute. */
export interface RebalanceRequest {
  accountIds: string[];
  target: { portfolioId: string } | { holdings: { ticker: string; weight: number }[] };
  /** When set, skips the engine-derived rate (and the projection run). */
  overrideLtcgRate?: number;
}
