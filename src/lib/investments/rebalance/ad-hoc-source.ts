import { normalizeExtractedHolding } from "@/lib/extraction/normalize-holdings";
import type { ExtractedHolding } from "@/lib/extraction/types";
import type { CurrentHolding } from "./assemble";
import type { ResolveTargetDeps, ResolvedSecurity } from "./resolve-target";

/**
 * An "outside" portfolio: positions the advisor typed in or pulled off a
 * statement, standing in for an account that is NOT among the client's assets.
 * One tax character covers the whole thing, the way a single account would.
 */
export interface AdHocSource {
  taxable: boolean;
  holdings: ExtractedHolding[];
}

export interface AdHocSourceResult {
  currentHoldings: CurrentHolding[];
  /**
   * Tickers that resolved via neither the cache nor the live classifier, each
   * listed once. Their value still counts toward the portfolio total and the
   * cost basis, but they contribute nothing to the asset mix — exactly what an
   * unclassified holding on a real account does. Callers surface them so the
   * shortfall in `coveragePct` is attributable rather than mysterious.
   */
  unresolved: string[];
}

/** The row names a security we can look up. Untickered rows (bonds, cash) never do. */
const tickerOf = (h: ExtractedHolding): string => (h.ticker ?? "").trim().toUpperCase();

/**
 * Turn typed / extracted positions into the same `CurrentHolding` shape the
 * account-backed path produces, resolving each ticker to its look-through
 * asset-class blend. Framework-free: all IO arrives through `deps`.
 */
export async function buildAdHocHoldings(
  source: AdHocSource,
  deps: ResolveTargetDeps,
): Promise<AdHocSourceResult> {
  const rows = source.holdings
    .map(normalizeExtractedHolding)
    .filter((h) => tickerOf(h).length > 0 || (h.name ?? "").trim().length > 0);

  // Resolve each distinct ticker once — a statement routinely lists the same
  // fund in several lots, and classifyLive hits an external API. An uploaded
  // statement can carry dozens of positions, so resolve in bounded-concurrency
  // chunks: sequential would stack dozens of round trips, unbounded would blow
  // the classifier's rate limit. Same width the import pipeline uses.
  const CONCURRENCY = 5;
  const tickers = [...new Set(rows.map(tickerOf).filter((t) => t.length > 0))];
  const blends = new Map<string, ResolvedSecurity | null>();
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      chunk.map(async (t) => (await deps.lookupCached(t)) ?? (await deps.classifyLive(t))),
    );
    chunk.forEach((t, j) => blends.set(t, resolved[j]));
  }

  const currentHoldings = rows.map<CurrentHolding>((h, i) => {
    const ticker = tickerOf(h);
    const resolved = ticker ? blends.get(ticker) : null;
    const marketValue = h.marketValue ?? 0;
    return {
      id: `adhoc-${i}`,
      securityId: resolved?.securityId ?? null,
      ticker: ticker || (h.name ?? "").trim(),
      shares: h.shares ?? 0,
      price: h.price ?? 0,
      marketValue,
      // No basis stated ⇒ treat the position as held at today's value, which
      // books no gain. Understating beats inventing one; the source editor
      // warns when a taxable portfolio is missing basis.
      costBasis: h.costBasis ?? marketValue,
      isTaxable: source.taxable,
      securityWeights: resolved?.slugWeights ?? [],
      overrides: [],
    };
  });

  const unresolved = [...blends].filter(([, v]) => v == null).map(([t]) => t);

  return { currentHoldings, unresolved };
}
