import { buildAllocationDonutSpec } from "@/lib/presentations/charts/donut-chart-spec";
import type { DonutSpec } from "@/lib/presentations/charts/types";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { resolveAllocationSource, type NormalizedAllocation } from "./resolve-source";
import type { AssetAllocationOptions } from "./options-schema";

export interface ComparisonTableRow { id: string; name: string; leftPct: number; rightPct: number; }
export interface ComparisonDiffRow { id: string; name: string; diffPct: number; }
export interface ExcludedAccountRow { id: string; name: string; value: number; }

export interface AssetAllocationData {
  subtitle: string;
  leftName: string;
  rightName: string | null;
  leftDonut: DonutSpec;
  rightDonut: DonutSpec | null;
  tableRows: ComparisonTableRow[];
  diffRows: ComparisonDiffRow[] | null;
  /** Left-source investable accounts with no asset mix (empty when showExcluded is off). */
  excludedRows: ExcludedAccountRow[];
  excludedTotal: number;
  disclosure: string;
}

function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

/** Per-class fraction within one source (its classes sum to ~1). */
function fractionsByClass(a: NormalizedAllocation): Map<string, number> {
  const total = a.byAssetClass.reduce((s, c) => s + c.value, 0) || 1;
  return new Map(a.byAssetClass.map((c) => [c.id, c.value / total]));
}

export function buildAssetAllocationData(
  bundle: InvestmentsBundle,
  options: AssetAllocationOptions,
): AssetAllocationData {
  // Left always resolves: a group falls back to all-liquid, and the all-liquid
  // group is guaranteed present by the bundle loader.
  const left =
    resolveAllocationSource(bundle, options.left, options) ??
    resolveAllocationSource(bundle, { kind: "group", id: "all-liquid" }, options)!;
  const right = resolveAllocationSource(bundle, options.right, options);

  const leftFr = fractionsByClass(left);
  const rightFr = right ? fractionsByClass(right) : null;

  // Union of classes across both sources, ordered by sortOrder then name.
  const classMeta = new Map<string, { name: string; sortOrder: number }>();
  for (const c of left.byAssetClass) classMeta.set(c.id, { name: c.name, sortOrder: c.sortOrder });
  if (right) for (const c of right.byAssetClass) if (!classMeta.has(c.id)) classMeta.set(c.id, { name: c.name, sortOrder: c.sortOrder });

  const orderedIds = [...classMeta.entries()]
    .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[1].name.localeCompare(b[1].name))
    .map(([id]) => id);

  const tableRows: ComparisonTableRow[] = options.showTable
    ? orderedIds.map((id) => ({
        id, name: classMeta.get(id)!.name,
        leftPct: leftFr.get(id) ?? 0,
        rightPct: rightFr?.get(id) ?? 0,
      }))
    : [];

  const diffRows: ComparisonDiffRow[] | null = right
    ? orderedIds
        .map((id) => ({ id, name: classMeta.get(id)!.name, diffPct: (leftFr.get(id) ?? 0) - (rightFr!.get(id) ?? 0) }))
        .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct))
    : null;

  // Only the left (household) source carries real accounts; a model portfolio has none.
  const excludedRows = options.showExcluded ? left.excludedAccounts : [];
  const excludedTotal = excludedRows.reduce((s, r) => s + r.value, 0);

  const disclosureParts: string[] = [];
  if (left.excludedNonInvestableValue > 0) disclosureParts.push(`$${fmt(left.excludedNonInvestableValue)} in business / real estate`);
  if (left.unallocatedValue > 0) disclosureParts.push(`$${fmt(left.unallocatedValue)} in accounts without an asset mix`);
  const disclosure = disclosureParts.length
    ? `Investable assets only. Excludes ${disclosureParts.join("; ")}.`
    : "Investable assets only.";

  return {
    subtitle: right ? `${left.displayName} vs ${right.displayName}` : left.displayName,
    leftName: left.displayName,
    rightName: right?.displayName ?? null,
    leftDonut: buildAllocationDonutSpec(left, options.view),
    rightDonut: right ? buildAllocationDonutSpec(right, options.view) : null,
    tableRows,
    diffRows,
    excludedRows,
    excludedTotal,
    disclosure,
  };
}
