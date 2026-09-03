// The live (DB + EODHD) implementation of SyncDeps. Kept apart from the decision
// logic in ./sync-derived-model-portfolio.ts so that stays unit-testable.
//
// `loadHoldings` resolves each ticker through the securities cache, falling back
// to a live classify — the same cache-then-classify order
// `computeAndCacheTickerPortfolioStats` uses. It deliberately does NOT read
// `ticker_portfolio_holdings.security_id`, which is NULL on every row in every
// environment because nothing has ever written it.
import { db } from "@/db";
import { eq, and, asc, isNotNull } from "drizzle-orm";
import { tickerPortfolioHoldings, assetClasses, modelPortfolioAllocations } from "@/db/schema";
import {
  getSecurityByTicker,
  upsertClassifiedSecurity,
} from "@/lib/investments/classification/persist";
import { classifySecurity } from "@/lib/investments/classification/classify";
import type { SyncDeps } from "@/lib/investments/sync-derived-model-portfolio";

async function slugWeightsForTicker(
  ticker: string,
): Promise<{ slug: string; weight: number }[]> {
  try {
    const cached = await getSecurityByTicker(ticker);
    if (cached) {
      return cached.weights.map((w) => ({
        slug: w.assetClassSlug,
        weight: parseFloat(w.weight),
      }));
    }
    const classified = await classifySecurity(ticker);
    if (!classified) return [];
    await upsertClassifiedSecurity(classified);
    const stored = await getSecurityByTicker(ticker);
    return stored
      ? stored.weights.map((w) => ({ slug: w.assetClassSlug, weight: parseFloat(w.weight) }))
      : [];
  } catch {
    // Soft-fail per ticker: an unresolvable ticker becomes unclassified weight,
    // which the coverage gate then judges. One bad ticker must not abort the
    // whole sync and leave the portfolio half-derived.
    return [];
  }
}

export function liveSyncDeps(): SyncDeps {
  return {
    loadHoldings: async (tickerPortfolioId) => {
      const rows = await db
        .select()
        .from(tickerPortfolioHoldings)
        .where(eq(tickerPortfolioHoldings.tickerPortfolioId, tickerPortfolioId))
        .orderBy(asc(tickerPortfolioHoldings.sortOrder));
      return Promise.all(
        rows.map(async (r) => ({
          ticker: r.displayTicker,
          weight: parseFloat(r.weight),
          slugWeights: await slugWeightsForTicker(r.displayTicker),
        })),
      );
    },

    loadSlugMap: async (firmId) => {
      const rows = await db
        .select()
        .from(assetClasses)
        .where(and(eq(assetClasses.firmId, firmId), isNotNull(assetClasses.slug)));
      const map: Record<string, string> = {};
      for (const ac of rows) if (ac.slug) map[ac.slug] = ac.id;
      return map;
    },

    writeAllocations: async (modelPortfolioId, allocations) => {
      await db
        .delete(modelPortfolioAllocations)
        .where(eq(modelPortfolioAllocations.modelPortfolioId, modelPortfolioId));
      if (allocations.length === 0) return;
      await db.insert(modelPortfolioAllocations).values(
        allocations.map((a) => ({
          modelPortfolioId,
          assetClassId: a.assetClassId,
          weight: String(a.weight),
        })),
      );
    },
  };
}
