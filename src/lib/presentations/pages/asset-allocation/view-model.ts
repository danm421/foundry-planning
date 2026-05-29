import {
  computeHouseholdAllocation, computeDrift,
  type InvestableAccount, type DriftRow,
} from "@/lib/investments/allocation";
import { resolveBenchmark, type AssetClassWeight } from "@/lib/investments/benchmarks";
import { buildInvestmentsResolver, type InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import {
  buildAllocationDonutSpec, buildBenchmarkDonutSpec,
} from "@/lib/presentations/charts/donut-chart-spec";
import type { DonutSpec } from "@/lib/presentations/charts/types";
import type { AssetAllocationOptions } from "./options-schema";

export interface AllocationTableRow {
  id: string; name: string; value: number; currentPct: number; targetPct: number | null;
}
export interface AssetAllocationData {
  subtitle: string;
  currentDonut: DonutSpec;
  benchmarkDonut: DonutSpec | null;
  tableRows: AllocationTableRow[];
  driftRows: DriftRow[] | null;
  disclosure: string;
}
function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

export function buildAssetAllocationData(
  bundle: InvestmentsBundle,
  options: AssetAllocationOptions,
): AssetAllocationData {
  const resolved = bundle.resolvedGroups[options.groupKey] ?? bundle.resolvedGroups["all-liquid"];
  const idSet = new Set(resolved.accountIds);

  const accounts: InvestableAccount[] = bundle.accounts
    .filter((a) => idSet.has(a.id))
    .map((a) => ({
      id: a.id, name: a.name, category: a.category, growthSource: a.growthSource,
      modelPortfolioId: a.modelPortfolioId, value: a.value, ownerEntityId: a.ownerEntityId,
      ownerEntityInPortfolio: a.ownerEntityId !== null && (options.includeOutOfEstate || a.entityInPortfolio),
    }));

  const resolver = buildInvestmentsResolver(bundle);
  const household = computeHouseholdAllocation(accounts, resolver, bundle.assetClassLites);

  const benchmark: AssetClassWeight[] | null = resolveBenchmark(
    bundle.selectedBenchmarkPortfolioId, bundle.portfolioLites, bundle.modelPortfolioAllocationsByPortfolioId,
  );
  const showDrift = benchmark !== null && resolved.isDefault && resolved.groupKey !== "all-liquid";

  const nameByClassId: Record<string, string> = {};
  for (const c of bundle.assetClassLites) nameByClassId[c.id] = c.name;
  const driftRows = showDrift ? computeDrift(household.byAssetClass, benchmark!, nameByClassId) : null;

  const targetByClass = new Map((benchmark ?? []).map((w) => [w.assetClassId, w.weight]));
  const tableRows: AllocationTableRow[] = household.byAssetClass.map((c) => ({
    id: c.id, name: c.name, value: c.value, currentPct: c.pctOfClassified,
    targetPct: benchmark ? targetByClass.get(c.id) ?? 0 : null,
  }));

  const disclosureParts: string[] = [];
  if (household.excludedNonInvestableValue > 0) disclosureParts.push(`$${fmt(household.excludedNonInvestableValue)} in business / real estate`);
  if (household.unallocatedValue > 0) disclosureParts.push(`$${fmt(household.unallocatedValue)} in accounts without an asset mix`);
  const disclosure = disclosureParts.length ? `Investable assets only. Excludes ${disclosureParts.join("; ")}.` : "Investable assets only.";

  return {
    subtitle: resolved.groupName,
    currentDonut: buildAllocationDonutSpec(household, options.view),
    benchmarkDonut: benchmark ? buildBenchmarkDonutSpec(benchmark, bundle.assetClassLites) : null,
    tableRows, driftRows, disclosure,
  };
}
