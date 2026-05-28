import { isLiquid, type AccountCategory } from "./liquid-filter";

export const DEFAULT_GROUP_KEYS = new Set([
  "all-liquid",
  "taxable",
  "retirement",
  "cash",
] as const);

export type DefaultGroupKey =
  typeof DEFAULT_GROUP_KEYS extends Set<infer T> ? T : never;

export type GroupKey = DefaultGroupKey | string; // UUID for custom groups

export type ResolvedGroup = {
  groupKey: GroupKey;
  groupName: string;
  groupColor: string | null;
  isDefault: boolean;
  accountIds: string[];
  strippedMemberCount?: number;
};

const DEFAULT_NAMES: Record<DefaultGroupKey, string> = {
  "all-liquid": "All Liquid Assets",
  taxable: "Taxable",
  retirement: "Retirement",
  cash: "Cash",
};

export type ResolverDeps = {
  fetchAccounts: () => Promise<Array<{ id: string; category: AccountCategory }>>;
  fetchCustomGroup: (
    clientId: string,
    groupId: string,
  ) => Promise<{
    name: string;
    color: string | null;
    memberAccountIds: string[];
  } | null>;
};

function isDefaultKey(key: string): key is DefaultGroupKey {
  return (DEFAULT_GROUP_KEYS as Set<string>).has(key);
}

export async function resolveGroup(
  clientId: string,
  groupKey: GroupKey,
  deps: ResolverDeps,
): Promise<ResolvedGroup> {
  const accounts = await deps.fetchAccounts();

  if (isDefaultKey(groupKey)) {
    const accountIds = accounts
      .filter((a) =>
        groupKey === "all-liquid"
          ? isLiquid(a.category)
          : a.category === groupKey,
      )
      .map((a) => a.id);
    return {
      groupKey,
      groupName: DEFAULT_NAMES[groupKey],
      groupColor: null,
      isDefault: true,
      accountIds,
    };
  }

  // Custom UUID branch — implemented in Task 4.
  throw new Error(`Custom group resolution not yet implemented: ${groupKey}`);
}
