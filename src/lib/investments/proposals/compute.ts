import { db } from "@/db";
import { clientRiskProfiles, modelPortfolioAllocations, modelPortfolios } from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { loadRebalanceInputs } from "@/lib/investments/rebalance/load-inputs";
import {
  assembleRebalanceResult,
  alignRebalanceSeries,
  type RebalanceInputs,
} from "@/lib/investments/rebalance/assemble";
import type { RebalanceRequest } from "@/lib/investments/rebalance/types";
import { buildStatsContext, computeStats } from "@/lib/investments/portfolio-stats";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import { buildProposalSnapshot } from "./snapshot";
import { loadExpenseRatios } from "./queries";
import type { FeeHolding, ProposalSnapshot, ProposedHolding, RiskLevel, RungPortfolio } from "./types";

export interface ComputeProposalArgs {
  clientId: string;
  firmId: string;
  request: RebalanceRequest;
  advisoryFeeCurrent: number | null;
  advisoryFeeProposed: number | null;
  /** Wall-clock read, injected so the caller owns the clock. */
  computedAt: Date;
}

export async function computeProposalSnapshot(
  args: ComputeProposalArgs,
): Promise<ProposalSnapshot> {
  const inputs = await loadRebalanceInputs(args.clientId, args.firmId, args.request);
  const compute = assembleRebalanceResult(inputs);
  const aligned = alignRebalanceSeries(inputs);

  const securityIds = [
    ...inputs.currentHoldings.map((h) => h.securityId),
    ...inputs.targetHoldings.map((h) => h.securityId),
  ].filter((s): s is string => s != null);
  const ratios = await loadExpenseRatios([...new Set(securityIds)]);

  const currentFeeHoldings: FeeHolding[] = inputs.currentHoldings.map((h) => ({
    marketValue: h.marketValue,
    expenseRatio: h.securityId ? (ratios.get(h.securityId) ?? null) : null,
  }));
  const proposedFeeHoldings: FeeHolding[] = inputs.targetHoldings.map((h) => ({
    marketValue: h.weight * compute.current.totalValue,
    expenseRatio: ratios.get(h.securityId) ?? null,
  }));
  const targetHoldings: ProposedHolding[] = inputs.targetHoldings.map((h) => ({
    ticker: h.ticker,
    name: null,
    weight: h.weight,
    expenseRatio: ratios.get(h.securityId) ?? null,
  }));

  const [profileRow] = await db
    .select()
    .from(clientRiskProfiles)
    .where(eq(clientRiskProfiles.clientId, args.clientId));

  const rungRows = await db
    .select({ id: modelPortfolios.id, riskLevel: modelPortfolios.riskLevel })
    .from(modelPortfolios)
    .where(and(eq(modelPortfolios.firmId, args.firmId), isNotNull(modelPortfolios.riskLevel)));

  // A rung's volatility is the CMA volatility of its allocation. `loadRebalanceInputs`
  // already carries the firm's asset classes and correlations, so reuse that
  // stats context rather than opening a second one.
  const rungs: RungPortfolio[] = await loadRungVolatilities(rungRows, inputs);

  // Always null, deliberately. A proposal's `target.portfolioId` addresses
  // `ticker_portfolios`, and that table carries no risk rung — only
  // `model_portfolios` is taggable. The lookup that used to sit here searched
  // `rungRows` (model portfolios) for a ticker-portfolio id, so it could never
  // match; it read as a resolution but was really a hard-coded null wearing a
  // query. Until fund portfolios become taggable, the nearest-volatility
  // estimate IS the honest answer and `buildSuitability` labels it as one.
  // Resolve the rung here if that tagging feature ever ships.
  const proposedLevel: RiskLevel | null = null;

  return buildProposalSnapshot({
    compute,
    computedAt: args.computedAt.toISOString(),
    currentFeeHoldings,
    proposedFeeHoldings,
    advisoryFeeCurrent: args.advisoryFeeCurrent,
    advisoryFeeProposed: args.advisoryFeeProposed,
    aligned,
    profile: profileRow
      ? {
          compositeLevel: profileRow.compositeLevel,
          compositeScore: profileRow.compositeScore,
          bindingConstraint: profileRow.bindingConstraint,
          confirmedAt: profileRow.toleranceConfirmedAt?.toISOString() ?? null,
        }
      : null,
    currentLevel: null, // client holdings are never a tagged model portfolio
    proposedLevel,
    rungs,
    targetHoldings,
  });
}

/**
 * CMA volatility of each rung-tagged model portfolio, used to place an
 * untagged portfolio on the firm's risk scale.
 *
 * A portfolio with no allocation rows is SKIPPED, not returned at zero
 * volatility — a zero-vol rung sits closer to every real portfolio than any
 * genuine conservative rung and would swallow every conservative placement.
 */
async function loadRungVolatilities(
  rungRows: readonly { id: string; riskLevel: RiskLevel | null }[],
  inputs: RebalanceInputs,
): Promise<RungPortfolio[]> {
  const tagged = rungRows.filter(
    (r): r is { id: string; riskLevel: RiskLevel } => r.riskLevel != null,
  );
  if (tagged.length === 0) return [];

  const allocRows = await db
    .select({
      modelPortfolioId: modelPortfolioAllocations.modelPortfolioId,
      assetClassId: modelPortfolioAllocations.assetClassId,
      weight: modelPortfolioAllocations.weight,
    })
    .from(modelPortfolioAllocations)
    .where(inArray(modelPortfolioAllocations.modelPortfolioId, tagged.map((r) => r.id)));

  const byPortfolio = new Map<string, AssetClassWeight[]>();
  for (const row of allocRows) {
    const list = byPortfolio.get(row.modelPortfolioId) ?? [];
    list.push({ assetClassId: row.assetClassId, weight: Number(row.weight) });
    byPortfolio.set(row.modelPortfolioId, list);
  }

  // Same three arguments assembleRebalanceResult passes to buildStatsContext,
  // so a rung's volatility is measured on exactly the scale the proposal's own
  // volatility is measured on.
  const ctx = buildStatsContext(
    inputs.assetClasses.map((c) => ({
      id: c.id,
      geometricReturn: c.geometricReturn,
      arithmeticMean: c.arithmeticMean,
      volatility: c.volatility,
      pctOrdinaryIncome: c.pctOrdinaryIncome,
      pctLtCapitalGains: c.pctLtCapitalGains,
      pctQualifiedDividends: c.pctQualifiedDividends,
      pctTaxExempt: c.pctTaxExempt,
    })),
    inputs.correlationRows,
    inputs.riskFreeRate,
  );

  const out: RungPortfolio[] = [];
  for (const r of tagged) {
    const weights = byPortfolio.get(r.id);
    if (!weights || weights.length === 0) continue;
    out.push({ level: r.riskLevel, volatility: computeStats(weights, ctx).stdDev });
  }
  return out;
}
