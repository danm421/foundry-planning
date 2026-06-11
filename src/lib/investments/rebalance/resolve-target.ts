import type { AssetClassWeight } from "@/lib/investments/benchmarks";

/** A ticker resolved to a security id + its look-through asset-class slug weights. */
export interface ResolvedSecurity {
  securityId: string;
  /** Look-through blend; expected to sum to ~1.0. If a stored blend is partial,
   *  the resulting targetAllocations will not sum to 1.0. */
  slugWeights: { slug: string; weight: number }[];
}

/** IO injected by the loader so this module stays framework-free. */
export interface ResolveTargetDeps {
  /** The firm's already-classified securities (DB). Return null when not found OR no weights. */
  lookupCached: (ticker: string) => Promise<ResolvedSecurity | null>;
  /** Live classify + persist fallback (EODHD). Return null on any failure / empty blend. */
  classifyLive: (ticker: string) => Promise<ResolvedSecurity | null>;
}

export interface ResolveTargetResult {
  targetHoldings: { securityId: string; ticker: string; weight: number }[];
  targetAllocations: AssetClassWeight[];
  /** Tickers that resolved via neither path — caller must fail loud, not emit $0. */
  unresolved: string[];
}

/** Thrown by the loader when any target ticker can't be classified. Route → 422.
 *  Not thrown in this module — `resolveTargetAllocations` returns `unresolved`; callers decide policy. */
export class UnclassifiableTickerError extends Error {
  constructor(public readonly tickers: string[]) {
    super(`Couldn't classify: ${tickers.join(", ")}`);
    this.name = "UnclassifiableTickerError";
  }
}

/**
 * Resolve typed target holdings into asset-class allocations, cache-first.
 * Weights are normalized to sum to 1.0 (a portfolio is relative weights).
 * Unresolved tickers are collected (never silently dropped to an empty target).
 */
export async function resolveTargetAllocations(
  holdings: { ticker: string; weight: number }[],
  slugToId: Map<string, string>,
  deps: ResolveTargetDeps,
): Promise<ResolveTargetResult> {
  const normalized = holdings
    .map((h) => ({ ticker: h.ticker.trim().toUpperCase(), weight: h.weight }))
    .filter((h) => h.ticker.length > 0);

  const total = normalized.reduce((s, h) => s + h.weight, 0);
  const scaled = total > 0 ? normalized.map((h) => ({ ...h, weight: h.weight / total })) : normalized;

  const targetHoldings: ResolveTargetResult["targetHoldings"] = [];
  const slugWeightAccum = new Map<string, number>();
  const unresolved: string[] = [];

  for (const { ticker, weight } of scaled) {
    const resolved = (await deps.lookupCached(ticker)) ?? (await deps.classifyLive(ticker));
    if (!resolved) {
      unresolved.push(ticker);
      continue;
    }
    targetHoldings.push({ securityId: resolved.securityId, ticker, weight });
    for (const sw of resolved.slugWeights) {
      const acId = slugToId.get(sw.slug);
      if (acId) slugWeightAccum.set(acId, (slugWeightAccum.get(acId) ?? 0) + weight * sw.weight);
    }
  }

  const targetAllocations = [...slugWeightAccum].map(([assetClassId, weight]) => ({ assetClassId, weight }));
  return { targetHoldings, targetAllocations, unresolved };
}
