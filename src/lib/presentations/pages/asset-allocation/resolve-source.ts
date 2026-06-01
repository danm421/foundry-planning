import { computeHouseholdAllocation, type InvestableAccount } from "@/lib/investments/allocation";
import { resolveBenchmark, type AssetClassWeight } from "@/lib/investments/benchmarks";
import { buildInvestmentsResolver, type InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { ASSET_TYPE_LABELS, ASSET_TYPE_SORT_ORDER, type AssetTypeId } from "@/lib/investments/asset-types";
import type { AllocationDonutInput } from "@/lib/presentations/charts/donut-chart-spec";
import type { SourceRef, AssetAllocationOptions } from "./options-schema";

export interface NormalizedAllocation extends AllocationDonutInput {
  displayName: string;
  /** Dollars in non-investable accounts (groups only; 0 for portfolios). Drives the disclosure. */
  excludedNonInvestableValue: number;
}

/** A model portfolio's weights → normalized allocation (weights treated as values). */
export function portfolioToNormalized(
  displayName: string,
  weights: AssetClassWeight[],
  assetClassLites: { id: string; name: string; sortOrder: number; assetType: AssetTypeId }[],
): NormalizedAllocation {
  const byId = new Map(assetClassLites.map((c) => [c.id, c]));
  const byAssetClass = weights
    .map((w) => {
      const c = byId.get(w.assetClassId);
      return {
        id: w.assetClassId,
        name: c?.name ?? w.assetClassId,
        sortOrder: c?.sortOrder ?? 0,
        value: w.weight,
        assetType: (c?.assetType ?? "other") as AssetTypeId,
      };
    })
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  const typeTotals = new Map<AssetTypeId, number>();
  for (const c of byAssetClass) typeTotals.set(c.assetType, (typeTotals.get(c.assetType) ?? 0) + c.value);
  const byAssetType = Array.from(typeTotals.entries())
    .map(([id, value]) => ({ id, label: ASSET_TYPE_LABELS[id], value, sortOrder: ASSET_TYPE_SORT_ORDER[id] }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ id, label, value }) => ({ id, label, value }));

  return { displayName, byAssetClass, byAssetType, unallocatedValue: 0, excludedNonInvestableValue: 0 };
}

/** An investment group → normalized current household allocation (real dollars). */
export function groupToNormalized(
  bundle: InvestmentsBundle,
  groupKey: string,
  includeOutOfEstate: boolean,
): NormalizedAllocation {
  // "all-liquid" is always present — the loader resolves it with in-memory deps
  // that cannot fail, so the fallback is always defined.
  const resolved = bundle.resolvedGroups[groupKey] ?? bundle.resolvedGroups["all-liquid"];
  const idSet = new Set(resolved.accountIds);
  const accounts: InvestableAccount[] = bundle.accounts
    .filter((a) => idSet.has(a.id))
    .map((a) => ({
      id: a.id, name: a.name, category: a.category, growthSource: a.growthSource,
      modelPortfolioId: a.modelPortfolioId, value: a.value, ownerEntityId: a.ownerEntityId,
      ownerEntityInPortfolio: includeOutOfEstate || a.entityInPortfolio,
    }));
  const resolver = buildInvestmentsResolver(bundle);
  const h = computeHouseholdAllocation(accounts, resolver, bundle.assetClassLites);
  return {
    displayName: resolved.groupName,
    byAssetClass: h.byAssetClass,
    byAssetType: h.byAssetType,
    unallocatedValue: h.unallocatedValue,
    excludedNonInvestableValue: h.excludedNonInvestableValue,
  };
}

/**
 * Resolve a SourceRef to a normalized allocation, or null when unresolvable
 * (null ref; a portfolio with no allocations; an unset "recommended" benchmark).
 */
export function resolveAllocationSource(
  bundle: InvestmentsBundle,
  ref: SourceRef | null,
  options: AssetAllocationOptions,
): NormalizedAllocation | null {
  if (!ref) return null;
  if (ref.kind === "group") {
    return groupToNormalized(bundle, ref.id, options.includeOutOfEstate);
  }
  const portfolioId = ref.kind === "recommended" ? bundle.selectedBenchmarkPortfolioId : ref.id;
  const weights = resolveBenchmark(
    portfolioId, bundle.portfolioLites, bundle.modelPortfolioAllocationsByPortfolioId,
  );
  if (!weights) return null;
  const name = bundle.portfolioLites.find((p) => p.id === portfolioId)?.name ?? "Model Portfolio";
  return portfolioToNormalized(name, weights, bundle.assetClassLites);
}
