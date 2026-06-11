import type { MonthlyReturn } from "./cma-stats";
import {
  blendedMonthlyReturns,
  portfolioStats,
  type PortfolioStats,
  type WeightedSeries,
} from "./portfolio-stats";

export const MIN_MONTHS = 36; // below this we don't trust the metrics
export const WARN_MONTHS = 60; // below this we flag in the UI

export interface PortfolioHoldingSeries {
  ticker: string;
  weight: number;
  returns: MonthlyReturn[];
}

export interface PortfolioPanel {
  stats: PortfolioStats;
  windowStart: string | null;
  windowEnd: string | null;
  nMonths: number;
  limitingTicker: string | null;
  insufficientHistory: boolean;
  shortHistory: boolean;
}

export function computePortfolioPanel(
  holdings: PortfolioHoldingSeries[],
  annualRiskFree: number,
): PortfolioPanel {
  const series: WeightedSeries[] = holdings.map((h) => ({ weight: h.weight, returns: h.returns }));
  const blended = blendedMonthlyReturns(series);
  const stats = portfolioStats(blended, annualRiskFree);

  // The limiting ticker is the holding whose earliest month is the latest,
  // since that start date defines the common window's left edge.
  let limitingTicker: string | null = null;
  let latestStart = "";
  for (const h of holdings) {
    const start = h.returns.map((r) => r.date).sort()[0];
    if (start && start > latestStart) {
      latestStart = start;
      limitingTicker = h.ticker;
    }
  }

  return {
    stats,
    windowStart: blended[0]?.date ?? null,
    windowEnd: blended.at(-1)?.date ?? null,
    nMonths: blended.length,
    limitingTicker: holdings.length > 1 ? limitingTicker : null,
    insufficientHistory: blended.length < MIN_MONTHS,
    shortHistory: blended.length < WARN_MONTHS,
  };
}

export interface SlugWeight { slug: string; weight: number; }
export interface TaxComposition {
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}
export interface LookThroughHolding { ticker: string; weight: number; slugWeights: SlugWeight[]; }
export interface LookThrough {
  allocation: { slug: string; weight: number }[];
  tax: TaxComposition;
  /**
   * Portfolio weight with no asset-class classification (holdings that failed
   * to classify, or whose slug weights don't sum to their holding weight). The
   * allocation + tax composition only cover `1 - unclassifiedWeight` of the
   * book — surface this so the tax line isn't read as covering the whole book.
   */
  unclassifiedWeight: number;
}

export function computeLookThrough(
  holdings: LookThroughHolding[],
  taxBySlug: Record<string, TaxComposition>,
): LookThrough {
  const allocBySlug = new Map<string, number>();
  let totalWeight = 0;
  for (const h of holdings) {
    totalWeight += h.weight;
    for (const sw of h.slugWeights) {
      allocBySlug.set(sw.slug, (allocBySlug.get(sw.slug) ?? 0) + h.weight * sw.weight);
    }
  }
  const tax: TaxComposition = {
    pctOrdinaryIncome: 0,
    pctLtCapitalGains: 0,
    pctQualifiedDividends: 0,
    pctTaxExempt: 0,
  };
  for (const [slug, w] of allocBySlug) {
    const t = taxBySlug[slug];
    if (!t) continue;
    tax.pctOrdinaryIncome += w * t.pctOrdinaryIncome;
    tax.pctLtCapitalGains += w * t.pctLtCapitalGains;
    tax.pctQualifiedDividends += w * t.pctQualifiedDividends;
    tax.pctTaxExempt += w * t.pctTaxExempt;
  }
  const classifiedWeight = [...allocBySlug.values()].reduce((s, w) => s + w, 0);
  return {
    allocation: [...allocBySlug.entries()].map(([slug, weight]) => ({ slug, weight })),
    tax,
    unclassifiedWeight: Math.max(0, totalWeight - classifiedWeight),
  };
}
