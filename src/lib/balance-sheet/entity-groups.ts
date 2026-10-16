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

/** The chip printed beside each entity's name. */
export const ENTITY_TYPE_LABEL: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  sole_prop: "Sole Prop",
  foundation: "Foundation",
  other: "Entity",
};

/** The By-Entity tab's All / Trusts / Businesses toggle. */
export type EntityFilter = "all" | "trusts" | "businesses";

export const ENTITY_FILTERS: readonly EntityFilter[] = ["all", "trusts", "businesses"];

export const isTrust = (g: Pick<EntityGroup, "entityType">) => g.entityType === "trust";

/** The toggle only appears when the household holds both trusts and
 *  businesses — with one kind there is nothing to filter. */
export function entityFilterApplies(groups: readonly EntityGroup[]): boolean {
  const trustCount = groups.filter(isTrust).length;
  return trustCount > 0 && trustCount < groups.length;
}

/** The groups the By-Entity tab shows under `filter`. A filter the toggle
 *  doesn't offer (see `entityFilterApplies`) shows every group. */
export function filterEntityGroups(groups: readonly EntityGroup[], filter: EntityFilter): EntityGroup[] {
  if (filter === "all" || !entityFilterApplies(groups)) return [...groups];
  return groups.filter((g) => (filter === "trusts" ? isTrust(g) : !isTrust(g)));
}
