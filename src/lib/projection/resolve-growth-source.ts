type AssetClassRow = {
  id: string;
  geometricReturn: string;
  pctOrdinaryIncome: string;
  pctLtCapitalGains: string;
  pctQualifiedDividends: string;
  pctTaxExempt: string;
};

type ModelPortfolioAllocationRow = {
  portfolioId: string;
  assetClassId: string;
  weight: string;
};

type AccountAssetAllocationRow = {
  accountId: string;
  assetClassId: string;
  weight: string;
};

type ClientCmaOverrideRow = {
  assetClassId: string;
  geometricReturn: string;
};

type PlanSettingsShape = {
  growthSourceTaxable: string;
  growthSourceCash: string;
  growthSourceRetirement: string;
  modelPortfolioIdTaxable: string | null;
  modelPortfolioIdCash: string | null;
  modelPortfolioIdRetirement: string | null;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
  inflationAssetClassId: string | null;
};

export type ResolvedGrowth = {
  geoReturn: number;
  pctOi: number;
  pctLtcg: number;
  pctQdiv: number;
  pctTaxEx: number;
};

export type ResolvedCategoryDefault = {
  rate: number;
  realization?: {
    pctOrdinaryIncome: number;
    pctLtCapitalGains: number;
    pctQualifiedDividends: number;
    pctTaxExempt: number;
    turnoverPct: number;
  };
};

export function createGrowthSourceResolver(ctx: {
  planSettings: PlanSettingsShape;
  assetClasses: readonly AssetClassRow[];
  modelPortfolios: ReadonlyArray<{ id: string }>;
  modelPortfolioAllocations: readonly ModelPortfolioAllocationRow[];
  accountAssetAllocations: readonly AccountAssetAllocationRow[];
  clientCmaOverrides: readonly ClientCmaOverrideRow[];
}) {
  const acMap = new Map(ctx.assetClasses.map((ac) => [ac.id, ac]));
  const overrideMap = new Map(
    ctx.clientCmaOverrides.map((o) => [o.assetClassId, parseFloat(o.geometricReturn)]),
  );

  const allocsByPortfolio = new Map<string, ModelPortfolioAllocationRow[]>();
  for (const a of ctx.modelPortfolioAllocations) {
    const list = allocsByPortfolio.get(a.portfolioId) ?? [];
    list.push(a);
    allocsByPortfolio.set(a.portfolioId, list);
  }

  const allocsByAccount = new Map<string, AccountAssetAllocationRow[]>();
  for (const a of ctx.accountAssetAllocations) {
    const list = allocsByAccount.get(a.accountId) ?? [];
    list.push(a);
    allocsByAccount.set(a.accountId, list);
  }

  function acReturn(id: string): number {
    const ov = overrideMap.get(id);
    if (ov != null) return ov;
    const ac = acMap.get(id);
    return ac ? parseFloat(ac.geometricReturn) : 0;
  }

  function resolveInflation(): number {
    const id = ctx.planSettings.inflationAssetClassId;
    if (!id) return 0.025;
    return acReturn(id);
  }

  const inflationFallback: ResolvedGrowth = {
    geoReturn: resolveInflation(),
    pctOi: 0,
    pctLtcg: 0,
    pctQdiv: 0,
    pctTaxEx: 0,
  };

  function resolvePortfolio(portfolioId: string): ResolvedGrowth {
    const allocs = allocsByPortfolio.get(portfolioId) ?? [];
    let geoReturn = 0, pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (!ac) continue;
      const w = parseFloat(alloc.weight);
      geoReturn += w * acReturn(alloc.assetClassId);
      pctOi += w * parseFloat(ac.pctOrdinaryIncome);
      pctLtcg += w * parseFloat(ac.pctLtCapitalGains);
      pctQdiv += w * parseFloat(ac.pctQualifiedDividends);
      pctTaxEx += w * parseFloat(ac.pctTaxExempt);
    }
    return { geoReturn, pctOi, pctLtcg, pctQdiv, pctTaxEx };
  }

  function resolveAccountMix(accountId: string): ResolvedGrowth {
    const allocs = allocsByAccount.get(accountId) ?? [];
    let totalWeight = 0;
    let geoReturn = 0, pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (!ac) continue;
      const w = parseFloat(alloc.weight);
      totalWeight += w;
      geoReturn += w * acReturn(alloc.assetClassId);
      pctOi += w * parseFloat(ac.pctOrdinaryIncome);
      pctLtcg += w * parseFloat(ac.pctLtCapitalGains);
      pctQdiv += w * parseFloat(ac.pctQualifiedDividends);
      pctTaxEx += w * parseFloat(ac.pctTaxExempt);
    }
    const unclassified = Math.max(0, 1 - totalWeight);
    if (unclassified > 0) {
      geoReturn += unclassified * inflationFallback.geoReturn;
      pctOi += unclassified * inflationFallback.pctOi;
      pctLtcg += unclassified * inflationFallback.pctLtcg;
      pctQdiv += unclassified * inflationFallback.pctQdiv;
      pctTaxEx += unclassified * inflationFallback.pctTaxEx;
    }
    return { geoReturn, pctOi, pctLtcg, pctQdiv, pctTaxEx };
  }

  function resolveCategoryDefault(category: string): ResolvedCategoryDefault {
    const s = ctx.planSettings;
    const sourceLookup: Record<
      string,
      { source: string; portfolioId: string | null; customRate: string } | undefined
    > = {
      taxable: {
        source: s.growthSourceTaxable,
        portfolioId: s.modelPortfolioIdTaxable,
        customRate: String(s.defaultGrowthTaxable),
      },
      cash: {
        source: s.growthSourceCash,
        portfolioId: s.modelPortfolioIdCash,
        customRate: String(s.defaultGrowthCash),
      },
      retirement: {
        source: s.growthSourceRetirement,
        portfolioId: s.modelPortfolioIdRetirement,
        customRate: String(s.defaultGrowthRetirement),
      },
    };
    const entry = sourceLookup[category];
    if (!entry) {
      const flatDefaults: Record<string, string> = {
        real_estate: String(s.defaultGrowthRealEstate),
        business: String(s.defaultGrowthBusiness),
        life_insurance: String(s.defaultGrowthLifeInsurance),
      };
      return { rate: parseFloat(flatDefaults[category] ?? "0.05") };
    }

    if (entry.source === "model_portfolio" && entry.portfolioId) {
      const p = resolvePortfolio(entry.portfolioId);
      return {
        rate: p.geoReturn,
        realization: {
          pctOrdinaryIncome: p.pctOi,
          pctLtCapitalGains: p.pctLtcg,
          pctQualifiedDividends: p.pctQdiv,
          pctTaxExempt: p.pctTaxEx,
          turnoverPct: 0,
        },
      };
    }
    if (entry.source === "inflation") {
      return { rate: resolveInflation() };
    }
    return { rate: parseFloat(entry.customRate) };
  }

  function resolveAccount(
    _accountId: string,
    category: string,
    growthSource: string,
  ): ResolvedCategoryDefault {
    if (growthSource === "category_default") return resolveCategoryDefault(category);
    // Other growth sources are resolved directly in loadClientData by calling
    // resolvePortfolio / resolveAccountMix / resolveInflation as needed.
    // This helper is kept thin on purpose; callers pick the right resolver per source.
    return resolveCategoryDefault(category);
  }

  function getCategoryGrowthSource(category: string): string {
    const s = ctx.planSettings;
    const lookup: Record<string, string | undefined> = {
      taxable: s.growthSourceTaxable,
      cash: s.growthSourceCash,
      retirement: s.growthSourceRetirement,
    };
    return lookup[category] ?? "custom";
  }

  return {
    resolveAccount,
    resolvePortfolio,
    resolveAccountMix,
    resolveCategoryDefault,
    resolveInflation,
    getCategoryGrowthSource,
  };
}
