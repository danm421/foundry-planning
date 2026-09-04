// Derive the allocations a model portfolio should hold, given the fund (ticker)
// portfolio it was promoted from. Reads are injected so the decision logic runs
// in plain vitest — the same shape `ResolveTargetDeps` uses in
// ./rebalance/resolve-target.ts.
//
// This function deliberately does NOT write. The caller decides what to do with
// the result, which is what lets the promote route check the gate BEFORE it
// creates anything — no insert-then-delete-on-failure dance.
//
// The failure policy is deliberate: when the mix can't be trusted, the caller
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
}

export interface SyncOutcome {
  ok: boolean;
  reason?: "unclassified" | "empty";
  /** Normalized to sum to 1.0. Empty whenever `ok` is false. */
  allocations: { assetClassId: string; weight: number }[];
  unclassifiedWeight: number;
  droppedSlugs: string[];
}

export async function deriveAllocationsForFund(
  args: { tickerPortfolioId: string; firmId: string },
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const holdings = await deps.loadHoldings(args.tickerPortfolioId);
  if (holdings.length === 0) {
    return {
      ok: false,
      reason: "empty",
      allocations: [],
      unclassifiedWeight: 0,
      droppedSlugs: [],
    };
  }

  const slugMap = await deps.loadSlugMap(args.firmId);
  // The empty second argument is the tax map — a derived model portfolio takes
  // its tax treatment from the asset classes themselves, not from this fold.
  const lookThrough = computeLookThrough(holdings, {});
  const derived = deriveModelAllocations(lookThrough, slugMap);

  return {
    ok: derived.ok,
    reason: derived.ok ? undefined : "unclassified",
    allocations: derived.allocations,
    unclassifiedWeight: derived.unclassifiedWeight,
    droppedSlugs: derived.droppedSlugs,
  };
}
