import { db } from "@/db";
import {
  tickerPortfolioHoldings,
  tickerPortfolioStats,
  securityPriceHistory,
  cmaSettings,
  assetClasses,
} from "@/db/schema";
import { eq, and, asc, isNotNull } from "drizzle-orm";
import { getSecurityByTicker, upsertClassifiedSecurity } from "@/lib/investments/classification/persist";
import { classifySecurity } from "@/lib/investments/classification/classify";
import { loadTickerMonthlyReturns } from "@/lib/ticker-history";
import type { MonthlyBar } from "@/lib/cma-stats";
import {
  computePortfolioPanel,
  computeLookThrough,
  type PortfolioHoldingSeries,
  type LookThroughHolding,
  type PortfolioPanel,
  type LookThrough,
} from "@/lib/ticker-portfolio-service";

/** Decimal-string coercion: null for non-finite or |x|>=1000 (decimal(9,6) overflow guard). */
function num(x: number): string | null {
  return Number.isFinite(x) && Math.abs(x) < 1000 ? String(x) : null;
}

export interface TickerPortfolioComputeResult {
  panel: PortfolioPanel;
  lookThrough: LookThrough;
}

/**
 * Resolve a ticker portfolio's holdings → blended realized stats + look-through,
 * caching price history (security_price_history) and the computed stats
 * (ticker_portfolio_stats). Shared by GET /stats and the monthly cron.
 * `asOfMonth` ("YYYY-MM") is passed in by the caller (route/cron use the clock).
 */
export async function computeAndCacheTickerPortfolioStats(args: {
  portfolioId: string;
  firmId: string;
  asOfMonth: string;
}): Promise<TickerPortfolioComputeResult> {
  const { portfolioId, firmId, asOfMonth } = args;

  // 2. Load holdings
  const holdings = await db
    .select()
    .from(tickerPortfolioHoldings)
    .where(eq(tickerPortfolioHoldings.tickerPortfolioId, portfolioId))
    .orderBy(asc(tickerPortfolioHoldings.sortOrder));

  // 4. Read firm risk-free rate
  const [settingsRow] = await db
    .select()
    .from(cmaSettings)
    .where(eq(cmaSettings.firmId, firmId));
  const riskFreeRate = settingsRow ? parseFloat(settingsRow.riskFreeRate) : 0.04;

  // 5. Build taxBySlug from firm's asset classes (only those with a slug)
  const acRows = await db
    .select()
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), isNotNull(assetClasses.slug)));

  const taxBySlug: Record<
    string,
    {
      pctOrdinaryIncome: number;
      pctLtCapitalGains: number;
      pctQualifiedDividends: number;
      pctTaxExempt: number;
    }
  > = {};
  for (const ac of acRows) {
    if (!ac.slug) continue;
    taxBySlug[ac.slug] = {
      pctOrdinaryIncome: parseFloat(ac.pctOrdinaryIncome),
      pctLtCapitalGains: parseFloat(ac.pctLtCapitalGains),
      pctQualifiedDividends: parseFloat(ac.pctQualifiedDividends),
      pctTaxExempt: parseFloat(ac.pctTaxExempt),
    };
  }

  // 6. Resolve each holding — soft-fail per ticker so one bad ticker can't abort the whole job
  const holdingsWithReturns: PortfolioHoldingSeries[] = [];
  const holdingsWithSlugs: LookThroughHolding[] = [];

  for (const holding of holdings) {
    let resolvedSecurityId: string | null = null;
    let slugWeights: { slug: string; weight: number }[] = [];

    try {
      const cached = await getSecurityByTicker(holding.displayTicker);
      if (cached) {
        resolvedSecurityId = cached.security.id;
        slugWeights = cached.weights.map((w) => ({
          slug: w.assetClassSlug,
          weight: parseFloat(w.weight),
        }));
      } else {
        const classified = await classifySecurity(holding.displayTicker);
        if (classified) {
          await upsertClassifiedSecurity(classified);
          const stored = await getSecurityByTicker(holding.displayTicker);
          if (stored) {
            resolvedSecurityId = stored.security.id;
            slugWeights = stored.weights.map((w) => ({
              slug: w.assetClassSlug,
              weight: parseFloat(w.weight),
            }));
          }
        }
      }
    } catch {
      // soft-fail: classification errors don't abort the whole request
    }

    const securityId = resolvedSecurityId ?? holding.securityId ?? null;

    // Keyed by the captured securityId (the canonical price-history key); the
    // ticker arg from TickerHistoryStore is intentionally unused here.
    const store = {
      readBars: async (): Promise<MonthlyBar[]> => {
        if (!securityId) return [];
        const rows = await db
          .select()
          .from(securityPriceHistory)
          .where(eq(securityPriceHistory.securityId, securityId))
          .orderBy(asc(securityPriceHistory.month));
        return rows.map((r) => ({ date: r.month, adjClose: parseFloat(r.adjustedClose) }));
      },
      upsertBars: async (_ticker: string, bars: MonthlyBar[]): Promise<void> => {
        if (!securityId || bars.length === 0) return;
        await db
          .insert(securityPriceHistory)
          .values(
            bars.map((b) => ({
              securityId,
              month: `${b.date.slice(0, 7)}-01`,
              adjustedClose: String(b.adjClose),
            }))
          )
          .onConflictDoNothing();
      },
    };

    let returns: Awaited<ReturnType<typeof loadTickerMonthlyReturns>> = [];
    if (securityId) {
      try {
        returns = await loadTickerMonthlyReturns(holding.displayTicker, { asOfMonth, store });
      } catch {
        // soft-fail: history fetch errors don't abort the whole request
      }
    }

    holdingsWithReturns.push({
      ticker: holding.displayTicker,
      weight: parseFloat(holding.weight),
      returns,
    });

    holdingsWithSlugs.push({
      ticker: holding.displayTicker,
      weight: parseFloat(holding.weight),
      slugWeights,
    });
  }

  // 7. Compute stats and look-through
  const panel = computePortfolioPanel(holdingsWithReturns, riskFreeRate);
  const lookThrough = computeLookThrough(holdingsWithSlugs, taxBySlug);

  // 8. Upsert stats cache (nullify non-finite metrics)
  const hasWindow = panel.nMonths > 0;
  const metrics = {
    annArithMean: hasWindow ? num(panel.stats.annArithMean) : null,
    annGeoReturn: hasWindow ? num(panel.stats.annGeoReturn) : null,
    annVolatility: hasWindow ? num(panel.stats.annVolatility) : null,
    downsideDeviation: hasWindow ? num(panel.stats.downsideDeviation) : null,
    sharpe: hasWindow ? num(panel.stats.sharpe) : null,
    sortino: hasWindow ? num(panel.stats.sortino) : null,
    maxDrawdown: hasWindow ? num(panel.stats.maxDrawdown) : null,
  };
  await db
    .insert(tickerPortfolioStats)
    .values({
      tickerPortfolioId: portfolioId,
      windowStart: panel.windowStart ? `${panel.windowStart.slice(0, 7)}-01` : null,
      windowEnd: panel.windowEnd ? `${panel.windowEnd.slice(0, 7)}-01` : null,
      nMonths: panel.nMonths,
      ...metrics,
      limitingTicker: panel.limitingTicker,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tickerPortfolioStats.tickerPortfolioId,
      set: {
        windowStart: panel.windowStart ? `${panel.windowStart.slice(0, 7)}-01` : null,
        windowEnd: panel.windowEnd ? `${panel.windowEnd.slice(0, 7)}-01` : null,
        nMonths: panel.nMonths,
        ...metrics,
        limitingTicker: panel.limitingTicker,
        computedAt: new Date(),
      },
    });

  return { panel, lookThrough };
}
