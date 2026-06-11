import { computePortfolioPanel, MIN_MONTHS, WARN_MONTHS } from "@/lib/ticker-portfolio-service";
import { buildStatsContext, computeStats } from "@/lib/investments/portfolio-stats";
import { rollupHoldings, type HoldingInput } from "@/lib/investments/holdings-rollup";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { MonthlyReturn } from "@/lib/cma-stats";
import type { CorrelationRow } from "@/engine/monteCarlo/correlation-matrix";
import { buildHoldingSeries } from "./panel-from-holdings";
import { alignToCommonWindow } from "./common-window";
import { toNamedWeights, buildAssetMixDelta, buildTradeSummary } from "./comparison";
import { estimateRealizedGain, deriveEffectiveLtcgRate, estimateRebalanceTax } from "./tax-estimate";
import type { CapGainsTier } from "@/lib/tax/types";
import type { PortfolioSide, RebalanceComputeResult } from "./types";

export interface AssetClassFull {
  id: string;
  name: string;
  slug: string | null;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export interface CurrentHolding {
  id: string;
  securityId: string | null;
  ticker: string;
  shares: number;
  price: number;
  marketValue: number;
  costBasis: number;
  isTaxable: boolean;
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
}

export interface RebalanceInputs {
  riskFreeRate: number;
  assetClasses: AssetClassFull[];
  /** Shape must match CorrelationRow from @/engine/monteCarlo/correlation-matrix:
   *  { assetClassIdA, assetClassIdB, correlation }. Empty array is valid. */
  correlationRows: CorrelationRow[];
  currentHoldings: CurrentHolding[];
  currentReturnsBySecurity: ReadonlyMap<string, MonthlyReturn[]>;
  targetHoldings: { securityId: string; ticker: string; weight: number }[];
  targetReturnsBySecurity: ReadonlyMap<string, MonthlyReturn[]>;
  targetAllocations: AssetClassWeight[];
  taxContext: {
    ordinaryBase: number;
    existingLtcg: number;
    brackets: CapGainsTier;
    niit: { magi: number; investmentIncome: number; threshold: number; rate: number };
  };
  overrideLtcgRate?: number;
}

export function assembleRebalanceResult(input: RebalanceInputs): RebalanceComputeResult {
  const names = new Map(input.assetClasses.map((c) => [c.id, c.name]));
  const slugToId = new Map<string, string>();
  for (const c of input.assetClasses) if (c.slug) slugToId.set(c.slug, c.id);

  // --- asset mix ---
  const rollup = rollupHoldings(
    input.currentHoldings.map<HoldingInput>((h) => ({
      id: h.id,
      securityId: h.securityId,
      shares: h.shares,
      price: h.price,
      costBasis: h.costBasis,
      securityWeights: h.securityWeights,
      overrides: h.overrides,
    })),
    slugToId,
  );
  const currentWeights: AssetClassWeight[] = rollup.allocations;
  const currentNamed = toNamedWeights(currentWeights, names);
  const targetNamed = toNamedWeights(input.targetAllocations, names);
  const totalValue = input.currentHoldings.reduce((s, h) => s + h.marketValue, 0);

  // --- CMA stats ---
  // buildStatsContext accepts AssetClassData[] (id + arithmeticMean + volatility + tax breakdown)
  // and CorrelationRow[] ({ assetClassIdA, assetClassIdB, correlation }).
  const ctx = buildStatsContext(
    input.assetClasses.map((c) => ({
      id: c.id,
      geometricReturn: c.geometricReturn,
      arithmeticMean: c.arithmeticMean,
      volatility: c.volatility,
      pctOrdinaryIncome: c.pctOrdinaryIncome,
      pctLtCapitalGains: c.pctLtCapitalGains,
      pctQualifiedDividends: c.pctQualifiedDividends,
      pctTaxExempt: c.pctTaxExempt,
    })),
    input.correlationRows,
    input.riskFreeRate,
  );
  const currentCma = computeStats(currentWeights, ctx);
  const targetCma = computeStats(input.targetAllocations, ctx);

  // --- realized stats over the common window ---
  const curBuilt = buildHoldingSeries(
    input.currentHoldings.map((h) => ({ securityId: h.securityId, ticker: h.ticker, marketValue: h.marketValue })),
    input.currentReturnsBySecurity,
  );
  const tgtBuilt = buildHoldingSeries(
    input.targetHoldings.map((h) => ({ securityId: h.securityId, ticker: h.ticker, marketValue: h.weight })),
    input.targetReturnsBySecurity,
  );
  const aligned = alignToCommonWindow(curBuilt.series, tgtBuilt.series);
  const insufficient = aligned.nMonths < MIN_MONTHS;

  const curPanel = insufficient ? null : computePortfolioPanel(aligned.a, input.riskFreeRate);
  const tgtPanel = insufficient ? null : computePortfolioPanel(aligned.b, input.riskFreeRate);

  const current: PortfolioSide = {
    totalValue,
    assetMix: currentNamed,
    realized: curPanel && !curPanel.insufficientHistory ? curPanel.stats : null,
    cma: currentCma,
    coveragePct: curBuilt.coveragePct,
  };
  const proposed: PortfolioSide = {
    totalValue,
    assetMix: targetNamed,
    realized: tgtPanel && !tgtPanel.insufficientHistory ? tgtPanel.stats : null,
    cma: targetCma,
    coveragePct: tgtBuilt.coveragePct,
  };

  // --- tax ---
  const taxableLots = input.currentHoldings.filter((h) => h.isTaxable);
  const gain = estimateRealizedGain(taxableLots.map((h) => ({ marketValue: h.marketValue, costBasis: h.costBasis })));
  const usingOverride = input.overrideLtcgRate != null;
  const rate = usingOverride
    ? input.overrideLtcgRate!
    : deriveEffectiveLtcgRate({ ...input.taxContext, incrementalGain: Math.max(0, gain.gain) });
  const tax = estimateRebalanceTax({
    gain: gain.gain,
    rate,
    rateSource: usingOverride ? "override" : "engine",
    taxableMarketValue: gain.marketValue,
    taxableCostBasis: gain.costBasis,
  });

  return {
    current,
    proposed,
    assetMixDelta: buildAssetMixDelta(currentNamed, targetNamed),
    tradeSummary: buildTradeSummary(currentNamed, targetNamed, totalValue),
    tax,
    realizedWindow: {
      windowStart: aligned.windowStart,
      windowEnd: aligned.windowEnd,
      nMonths: aligned.nMonths,
      insufficientHistory: insufficient,
      shortHistory: !insufficient && aligned.nMonths < WARN_MONTHS,
    },
  };
}
