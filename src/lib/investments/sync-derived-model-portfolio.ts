// Re-derive a derived model portfolio's allocations from its source fund
// portfolio. IO is injected so the decision logic runs in plain vitest — the
// same shape `ResolveTargetDeps` uses in ./rebalance/resolve-target.ts.
//
// The failure policy is deliberate: a sync that cannot produce a trustworthy mix
// leaves the previous allocations untouched. A plan already built on this
// portfolio must not silently change because a data vendor reclassified a fund.
import { computeLookThrough } from "@/lib/ticker-portfolio-service";
import { deriveModelAllocations } from "@/lib/investments/derive-model-allocations";

export interface SyncDeps {
  loadHoldings: (
    tickerPortfolioId: string,
  ) => Promise<
    { ticker: string; weight: number; slugWeights: { slug: string; weight: number }[] }[]
  >;
  loadSlugMap: (firmId: string) => Promise<Record<string, string>>;
  writeAllocations: (
    modelPortfolioId: string,
    rows: { assetClassId: string; weight: number }[],
  ) => Promise<void>;
}

export interface SyncOutcome {
  ok: boolean;
  reason?: "unclassified" | "empty";
  unclassifiedWeight: number;
  droppedSlugs: string[];
  written: number;
}

export async function syncDerivedAllocations(
  args: { tickerPortfolioId: string; modelPortfolioId: string; firmId: string },
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const holdings = await deps.loadHoldings(args.tickerPortfolioId);
  if (holdings.length === 0) {
    return { ok: false, reason: "empty", unclassifiedWeight: 0, droppedSlugs: [], written: 0 };
  }

  const slugMap = await deps.loadSlugMap(args.firmId);
  // The empty second argument is the tax map — the derived model portfolio takes
  // its tax treatment from the asset classes themselves, not from this fold.
  const lookThrough = computeLookThrough(holdings, {});
  const derived = deriveModelAllocations(lookThrough, slugMap);

  if (!derived.ok) {
    return {
      ok: false,
      reason: "unclassified",
      unclassifiedWeight: derived.unclassifiedWeight,
      droppedSlugs: derived.droppedSlugs,
      written: 0,
    };
  }

  await deps.writeAllocations(args.modelPortfolioId, derived.allocations);
  return {
    ok: true,
    unclassifiedWeight: derived.unclassifiedWeight,
    droppedSlugs: derived.droppedSlugs,
    written: derived.allocations.length,
  };
}
