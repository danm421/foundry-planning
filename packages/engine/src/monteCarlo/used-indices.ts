import type { AccountAssetMix } from "./trial";

export interface UsedIndicesOptions {
  /** Add this id even when no account explicitly references it. Use when the
   *  inflation class is randomized (inflationRateSource = "asset_class") and
   *  downstream calculations need CPI returns sampled alongside the others. */
  inflationAssetClassId?: string;
}

/**
 * Per the eMoney whitepaper's "Included Indices" (p.6/p.7), only the asset
 * classes actually referenced by a client's plan participate in the Monte
 * Carlo. This helper computes that union from the per-account mix map that
 * the orchestrator is about to feed into `runMonteCarlo`.
 *
 * Zero-weight entries are ignored — a mix row with weight = 0 is a no-op and
 * doesn't make the index "used".
 */
export function detectUsedAssetClassIds(
  accountMixes: Map<string, AccountAssetMix[]>,
  options: UsedIndicesOptions = {},
): string[] {
  const used = new Set<string>();
  for (const mix of accountMixes.values()) {
    for (const entry of mix) {
      if (entry.weight !== 0) used.add(entry.assetClassId);
    }
  }
  if (options.inflationAssetClassId) used.add(options.inflationAssetClassId);
  return Array.from(used);
}
