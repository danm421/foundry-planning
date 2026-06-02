import type { EntityGroup } from "@/components/balance-sheet-report/view-model";

/** Strip the synthetic flat-value row when an entity also holds real accounts,
 *  so its enterprise value isn't double-counted against the accounts it owns.
 *  Recomputes `assetTotal` and `netWorth` from the remaining rows. */
export function dedupeFlatEntityGroup(group: EntityGroup): EntityGroup {
  const hasReal = group.assetRows.some((r) => !r.rowKey.startsWith("flat:"));
  if (!hasReal) return group;
  const assetRows = group.assetRows.filter((r) => !r.rowKey.startsWith("flat:"));
  const assetTotal = assetRows.reduce((s, r) => s + r.value, 0);
  return { ...group, assetRows, assetTotal, netWorth: assetTotal - group.liabilityTotal };
}

/** Presentation prep shared by the on-screen By-Entity tab and the entities
 *  balance-sheet PDF: dedupe flat rows, then drop entities with no rows. */
export function prepareEntityGroups(groups: readonly EntityGroup[]): EntityGroup[] {
  return groups
    .map(dedupeFlatEntityGroup)
    .filter((g) => g.assetRows.length > 0 || g.liabilityRows.length > 0);
}
