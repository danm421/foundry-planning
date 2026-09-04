// The live (DB + EODHD) side of deriving a model portfolio from a fund
// portfolio. Kept apart from the decision logic in
// ./sync-derived-model-portfolio.ts so that stays unit-testable.
import { db } from "@/db";
import { eq, and, asc, isNotNull } from "drizzle-orm";
import {
  tickerPortfolioHoldings,
  assetClasses,
  modelPortfolios,
  modelPortfolioAllocations,
} from "@/db/schema";
import { resolveSlugWeightsByTicker } from "@/lib/investments/classification/persist";
import {
  deriveAllocationsForFund,
  type SyncDeps,
  type SyncOutcome,
} from "@/lib/investments/sync-derived-model-portfolio";

/**
 * Live read deps. Call once per request or per cron run and reuse it: the
 * instance memoizes each firm's slug→assetClassId map, which is otherwise
 * re-queried identically for every portfolio in the run.
 */
export function liveSyncDeps(): SyncDeps {
  const slugMapByFirm = new Map<string, Record<string, string>>();

  return {
    loadHoldings: async (tickerPortfolioId) => {
      const rows = await db
        .select()
        .from(tickerPortfolioHoldings)
        .where(eq(tickerPortfolioHoldings.tickerPortfolioId, tickerPortfolioId))
        .orderBy(asc(tickerPortfolioHoldings.sortOrder));
      // Resolves by TICKER, not by the row's `security_id` — that column is NULL
      // on every row in every environment because nothing has ever written it.
      return Promise.all(
        rows.map(async (r) => ({
          ticker: r.displayTicker,
          weight: parseFloat(r.weight),
          slugWeights: await resolveSlugWeightsByTicker(r.displayTicker),
        })),
      );
    },

    loadSlugMap: async (firmId) => {
      const cached = slugMapByFirm.get(firmId);
      if (cached) return cached;
      const rows = await db
        .select()
        .from(assetClasses)
        .where(and(eq(assetClasses.firmId, firmId), isNotNull(assetClasses.slug)));
      const map: Record<string, string> = {};
      for (const ac of rows) if (ac.slug) map[ac.slug] = ac.id;
      slugMapByFirm.set(firmId, map);
      return map;
    },
  };
}

/** Replace a derived model portfolio's allocation rows. */
export async function writeDerivedAllocations(
  modelPortfolioId: string,
  allocations: { assetClassId: string; weight: number }[],
): Promise<void> {
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
}

/**
 * Re-derive and rewrite the model portfolio linked to this fund, if there is
 * one. Returns null when the fund was never promoted, and an outcome with
 * `ok: false` when the mix no longer classifies well enough — in which case the
 * existing allocations are deliberately left as they were.
 *
 * Shared by the holdings-save route and the monthly cron so the two can't drift.
 */
export async function resyncDerivedForFund(
  tickerPortfolioId: string,
  firmId: string,
  deps: SyncDeps = liveSyncDeps(),
  modelPortfolioId?: string,
): Promise<SyncOutcome | null> {
  let targetId = modelPortfolioId;
  if (!targetId) {
    const [derived] = await db
      .select({ id: modelPortfolios.id })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.sourceTickerPortfolioId, tickerPortfolioId));
    if (!derived) return null;
    targetId = derived.id;
  }

  const outcome = await deriveAllocationsForFund({ tickerPortfolioId, firmId }, deps);
  if (outcome.ok) await writeDerivedAllocations(targetId, outcome.allocations);
  return outcome;
}
