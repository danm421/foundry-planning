import type { AssetClassWeight } from "./benchmarks";
import type { RiskReturnStats } from "./portfolio-stats";
import type { AssetClassDetail, AccountDetail } from "./analysis-dataset";

export interface BreakdownEntry {
  assetClassId: string;
  name: string;
  weight: number;
  value: number | null;
  stats: RiskReturnStats;
}

export function buildBreakdown(
  weights: AssetClassWeight[],
  groupValue: number | null,
  assetClasses: AssetClassDetail[],
): BreakdownEntry[] {
  const byId = new Map(assetClasses.map((c) => [c.id, c]));
  return weights
    .map((w): BreakdownEntry | null => {
      const ac = byId.get(w.assetClassId);
      if (!ac) return null;
      return {
        assetClassId: w.assetClassId,
        name: ac.name,
        weight: w.weight,
        value: groupValue === null ? null : groupValue * w.weight,
        stats: ac.stats,
      };
    })
    .filter((e): e is BreakdownEntry => e !== null)
    .sort((a, b) => b.weight - a.weight);
}

export interface WhereHeldAccount {
  accountId: string;
  name: string;
  category: string;
  value: number;
  classWeight: number;
  classValue: number;
}

export interface WhereHeldRollup {
  accounts: WhereHeldAccount[];
  byCategory: { category: string; classValue: number }[];
  byCustomGroup: { groupId: string; classValue: number }[];
  totalClassValue: number;
}

export function buildWhereHeld(
  assetClassId: string,
  accountsById: Record<string, AccountDetail>,
  categoryMembers: Record<string, string[]>,
  customGroupMembers: Record<string, string[]>,
): WhereHeldRollup {
  const accounts: WhereHeldAccount[] = Object.entries(accountsById)
    .map(([accountId, a]) => {
      const classWeight = a.weights.find((x) => x.assetClassId === assetClassId)?.weight ?? 0;
      return {
        accountId,
        name: a.name,
        category: a.category,
        value: a.value,
        classWeight,
        classValue: a.value * classWeight,
      };
    })
    .filter((a) => a.classValue > 0)
    .sort((a, b) => b.classValue - a.classValue);

  // Reuse the per-account class dollars already computed above for the rollups
  // (accounts is filtered to classValue > 0, so any id absent here contributes 0).
  const classValueByAccountId = new Map(accounts.map((a) => [a.accountId, a.classValue]));
  const classValueOf = (id: string): number => classValueByAccountId.get(id) ?? 0;

  const byCategory = Object.entries(categoryMembers)
    .map(([category, ids]) => ({ category, classValue: ids.reduce((s, id) => s + classValueOf(id), 0) }))
    .filter((c) => c.classValue > 0)
    .sort((a, b) => b.classValue - a.classValue);

  const byCustomGroup = Object.entries(customGroupMembers)
    .map(([groupId, ids]) => ({ groupId, classValue: ids.reduce((s, id) => s + classValueOf(id), 0) }))
    .filter((g) => g.classValue > 0)
    .sort((a, b) => b.classValue - a.classValue);

  const totalClassValue = accounts.reduce((s, a) => s + a.classValue, 0);

  return { accounts, byCategory, byCustomGroup, totalClassValue };
}
