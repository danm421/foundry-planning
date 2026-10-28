/** How a year's growth is taxed, each a fraction (0–1) of that growth. */
export interface RealizationMix {
  pctOrdinaryIncome: number;
  pctQualifiedDividends: number;
  pctLtCapitalGains: number;
  pctTaxExempt: number;
}

/** Weight-blended realization mix of an allocation — the same sum the
 *  projection takes (`resolve-growth-source.ts`), so the account form can show
 *  what a portfolio realizes. Weight on an asset class not in the list, and any
 *  unallocated remainder, realizes nothing. */
export function blendRealization(
  allocations: readonly { assetClassId: string; weight: number }[],
  assetClasses: readonly ({ id: string } & RealizationMix)[],
): RealizationMix {
  const byId = new Map(assetClasses.map((ac) => [ac.id, ac]));
  const mix: RealizationMix = { pctOrdinaryIncome: 0, pctQualifiedDividends: 0, pctLtCapitalGains: 0, pctTaxExempt: 0 };
  for (const { assetClassId, weight } of allocations) {
    const ac = byId.get(assetClassId);
    if (!ac) continue;
    mix.pctOrdinaryIncome += weight * ac.pctOrdinaryIncome;
    mix.pctQualifiedDividends += weight * ac.pctQualifiedDividends;
    mix.pctLtCapitalGains += weight * ac.pctLtCapitalGains;
    mix.pctTaxExempt += weight * ac.pctTaxExempt;
  }
  return mix;
}

/** An asset-class row's stored realization split (decimal strings) as numbers. */
export function realizationMixOf(row: {
  pctOrdinaryIncome: string;
  pctQualifiedDividends: string;
  pctLtCapitalGains: string;
  pctTaxExempt: string;
}): RealizationMix {
  return {
    pctOrdinaryIncome: parseFloat(row.pctOrdinaryIncome),
    pctQualifiedDividends: parseFloat(row.pctQualifiedDividends),
    pctLtCapitalGains: parseFloat(row.pctLtCapitalGains),
    pctTaxExempt: parseFloat(row.pctTaxExempt),
  };
}
