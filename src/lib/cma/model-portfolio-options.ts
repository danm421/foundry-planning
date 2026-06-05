// src/lib/cma/model-portfolio-options.ts
// Pure helper: blend each model portfolio's allocations against asset-class
// geometric returns. Shared by the Assumptions page, the onboarding wizard,
// and the quick-start wizard so the computation lives in exactly one place.

export interface ModelPortfolioOption {
  id: string;
  name: string;
  /** Allocation-weighted geometric return, as a fraction (e.g. 0.062). */
  blendedReturn: number;
}

export function buildModelPortfolioOptions(
  portfolios: { id: string; name: string }[],
  allocations: { modelPortfolioId: string; assetClassId: string; weight: string }[],
  assetClasses: { id: string; geometricReturn: string }[],
): ModelPortfolioOption[] {
  const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
  return portfolios.map((p) => {
    const allocs = allocations.filter((a) => a.modelPortfolioId === p.id);
    let blendedReturn = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (ac) blendedReturn += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
    }
    return { id: p.id, name: p.name, blendedReturn };
  });
}
