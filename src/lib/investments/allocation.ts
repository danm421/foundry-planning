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
