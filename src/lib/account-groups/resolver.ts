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

export const DEFAULT_NAMES: Record<DefaultGroupKey, string> = {
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

export function isDefaultKey(key: string): key is DefaultGroupKey {
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

  // Custom UUID branch.
  const custom = await deps.fetchCustomGroup(clientId, groupKey);
  if (!custom) {
    throw new Error(`Account group not found: ${groupKey}`);
  }

  const liquidAccountIds = new Set(
    accounts.filter((a) => isLiquid(a.category)).map((a) => a.id),
  );
  const accountIds: string[] = [];
  let stripped = 0;
  for (const aid of custom.memberAccountIds) {
    if (liquidAccountIds.has(aid)) {
      accountIds.push(aid);
    } else {
      stripped += 1;
    }
  }

  return {
    groupKey,
    groupName: custom.name,
    groupColor: custom.color,
    isDefault: false,
    accountIds,
    strippedMemberCount: stripped,
  };
}
