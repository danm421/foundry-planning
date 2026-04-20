export interface AssetClassData {
  id: string;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export interface AllocationEntry {
  assetClassId: string;
  weight: number;
}

export interface BlendedResult {
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export function blendPortfolio(
  allocations: AllocationEntry[],
  assetClasses: AssetClassData[]
): BlendedResult {
  const result: BlendedResult = {
    geometricReturn: 0,
    arithmeticMean: 0,
    volatility: 0,
    pctOrdinaryIncome: 0,
    pctLtCapitalGains: 0,
    pctQualifiedDividends: 0,
    pctTaxExempt: 0,
  };

  const classMap = new Map(assetClasses.map((ac) => [ac.id, ac]));

  for (const alloc of allocations) {
    const ac = classMap.get(alloc.assetClassId);
    if (!ac) continue;
    result.geometricReturn += alloc.weight * ac.geometricReturn;
    result.arithmeticMean += alloc.weight * ac.arithmeticMean;
    result.volatility += alloc.weight * ac.volatility;
    result.pctOrdinaryIncome += alloc.weight * ac.pctOrdinaryIncome;
    result.pctLtCapitalGains += alloc.weight * ac.pctLtCapitalGains;
    result.pctQualifiedDividends += alloc.weight * ac.pctQualifiedDividends;
    result.pctTaxExempt += alloc.weight * ac.pctTaxExempt;
  }

  return result;
}
