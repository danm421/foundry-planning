import type { AssetClassWeight } from "./benchmarks";

export type GrowthSource = "default" | "model_portfolio" | "custom" | "asset_mix";

export type AccountCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "real_estate"
  | "business"
  | "life_insurance";

export interface AccountLite {
  id: string;
  category: AccountCategory;
  growthSource: GrowthSource;
  modelPortfolioId: string | null;
}

export interface PlanSettingsLite {
  growthSourceTaxable: GrowthSource;
  growthSourceCash: GrowthSource;
  growthSourceRetirement: GrowthSource;
  modelPortfolioIdTaxable: string | null;
  modelPortfolioIdCash: string | null;
  modelPortfolioIdRetirement: string | null;
}

export type AccountAllocationResult =
  | { classified: AssetClassWeight[] }
  | { unallocated: true };

function planEntryForCategory(
  category: AccountCategory,
  plan: PlanSettingsLite,
): { source: GrowthSource; portfolioId: string | null } | null {
  if (category === "taxable")
    return { source: plan.growthSourceTaxable, portfolioId: plan.modelPortfolioIdTaxable };
  if (category === "cash")
    return { source: plan.growthSourceCash, portfolioId: plan.modelPortfolioIdCash };
  if (category === "retirement")
    return { source: plan.growthSourceRetirement, portfolioId: plan.modelPortfolioIdRetirement };
  return null;
}

/**
 * Resolve an account to a list of asset-class weights, walking the growth_source
 * chain: account.growthSource → (if "default") plan_settings category entry →
 * either explicit account_asset_allocations rows or a model portfolio's allocations.
 * Terminal "custom" or missing data → unallocated.
 */
export function resolveAccountAllocation(
  account: AccountLite,
  accountMixByAccountId: Record<string, AssetClassWeight[]>,
  modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]>,
  plan: PlanSettingsLite,
): AccountAllocationResult {
  if (account.growthSource === "asset_mix") {
    const rows = accountMixByAccountId[account.id];
    if (rows && rows.length > 0) return { classified: rows };
    return { unallocated: true };
  }

  if (account.growthSource === "model_portfolio") {
    if (!account.modelPortfolioId) return { unallocated: true };
    const rows = modelPortfolioAllocationsByPortfolioId[account.modelPortfolioId];
    if (rows && rows.length > 0) return { classified: rows };
    return { unallocated: true };
  }

  if (account.growthSource === "default") {
    const entry = planEntryForCategory(account.category, plan);
    if (!entry) return { unallocated: true };
    if (entry.source === "model_portfolio" && entry.portfolioId) {
      const rows = modelPortfolioAllocationsByPortfolioId[entry.portfolioId];
      if (rows && rows.length > 0) return { classified: rows };
    }
    return { unallocated: true };
  }

  // "custom" → no asset-class breakdown.
  return { unallocated: true };
}

export interface AssetClassLite {
  id: string;
  name: string;
  sortOrder: number;
}

export interface InvestableAccount extends AccountLite {
  name: string;
  value: number;
  ownerEntityId: string | null;
}

export interface AssetClassRollup {
  id: string;
  name: string;
  sortOrder: number;
  value: number;
  pctOfClassified: number;
}

export interface AccountContribution {
  accountId: string;
  accountName: string;
  accountValue: number;
  valueInClass: number;
  weightInClass: number;
}

export interface HouseholdAllocation {
  byAssetClass: AssetClassRollup[];
  unallocatedValue: number;
  totalClassifiedValue: number;
  totalInvestableValue: number;
  excludedNonInvestableValue: number;
  contributionsByAssetClass: Record<string, AccountContribution[]>;
  unallocatedContributions: AccountContribution[];
}

const INVESTABLE_CATEGORIES: ReadonlySet<AccountCategory> = new Set([
  "taxable",
  "cash",
  "retirement",
]);

/**
 * Roll up dollar-weighted resolved allocations across investable accounts.
 * "Investable" = category ∈ {taxable, cash, retirement} AND ownerEntityId is null.
 * Non-investable dollar totals are surfaced in excludedNonInvestableValue for
 * the disclosure line; unresolvable account dollars go into unallocatedValue.
 */
export function computeHouseholdAllocation(
  accounts: InvestableAccount[],
  resolver: (acct: AccountLite) => AccountAllocationResult,
  assetClasses: AssetClassLite[],
): HouseholdAllocation {
  let totalInvestableValue = 0;
  let unallocatedValue = 0;
  let excludedNonInvestableValue = 0;
  const byId = new Map<string, number>();
  const contribById = new Map<string, AccountContribution[]>();
  const unallocatedContributions: AccountContribution[] = [];

  for (const acct of accounts) {
    const isInvestable = INVESTABLE_CATEGORIES.has(acct.category) && acct.ownerEntityId === null;
    if (!isInvestable) {
      excludedNonInvestableValue += acct.value;
      continue;
    }
    totalInvestableValue += acct.value;

    const result = resolver(acct);
    if ("unallocated" in result) {
      unallocatedValue += acct.value;
      unallocatedContributions.push({
        accountId: acct.id,
        accountName: acct.name,
        accountValue: acct.value,
        valueInClass: acct.value,
        weightInClass: 1,
      });
      continue;
    }
    for (const row of result.classified) {
      const dollars = acct.value * row.weight;
      byId.set(row.assetClassId, (byId.get(row.assetClassId) ?? 0) + dollars);

      const list = contribById.get(row.assetClassId) ?? [];
      list.push({
        accountId: acct.id,
        accountName: acct.name,
        accountValue: acct.value,
        valueInClass: dollars,
        weightInClass: row.weight,
      });
      contribById.set(row.assetClassId, list);
    }
  }

  const totalClassifiedValue = totalInvestableValue - unallocatedValue;

  const byAssetClass: AssetClassRollup[] = assetClasses
    .map((ac) => {
      const value = byId.get(ac.id) ?? 0;
      return {
        id: ac.id,
        name: ac.name,
        sortOrder: ac.sortOrder,
        value,
        pctOfClassified: totalClassifiedValue > 0 ? value / totalClassifiedValue : 0,
      };
    })
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);

  const contributionsByAssetClass: Record<string, AccountContribution[]> = {};
  for (const [classId, list] of contribById) {
    contributionsByAssetClass[classId] = list
      .slice()
      .sort((a, b) => b.valueInClass - a.valueInClass);
  }

  unallocatedContributions.sort((a, b) => b.valueInClass - a.valueInClass);

  return {
    byAssetClass,
    unallocatedValue,
    totalClassifiedValue,
    totalInvestableValue,
    excludedNonInvestableValue,
    contributionsByAssetClass,
    unallocatedContributions,
  };
}

export interface DriftRow {
  assetClassId: string;
  name: string;
  currentPct: number;
  targetPct: number;
  diffPct: number;
}

/**
 * Compute Current − Target drift per asset class over the union of classes
 * present in either side. Missing side is treated as 0. Sorts by |diff| desc.
 * Returns [] when target is empty (no benchmark selected).
 */
export function computeDrift(
  current: AssetClassRollup[],
  target: AssetClassWeight[],
  names: Record<string, string>,
): DriftRow[] {
  if (target.length === 0) return [];

  const ids = new Set<string>();
  for (const c of current) ids.add(c.id);
  for (const t of target) ids.add(t.assetClassId);

  const currentMap = new Map(current.map((c) => [c.id, c.pctOfClassified]));
  const targetMap = new Map(target.map((t) => [t.assetClassId, t.weight]));

  const rows: DriftRow[] = [];
  for (const id of ids) {
    const currentPct = currentMap.get(id) ?? 0;
    const targetPct = targetMap.get(id) ?? 0;
    rows.push({
      assetClassId: id,
      name: names[id] ?? id,
      currentPct,
      targetPct,
      diffPct: currentPct - targetPct,
    });
  }

  rows.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return rows;
}
