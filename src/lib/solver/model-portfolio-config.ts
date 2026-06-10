import type { Account } from "@/engine/types";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { ResolvedGrowth } from "@/lib/projection/resolve-growth-source";

export type AccountRealization = NonNullable<Account["realization"]>;

/** A model portfolio resolved to everything the synthetic "Additional Savings"
 *  account needs: deterministic growth, tax realization, and the MC asset mix. */
export interface SolverModelPortfolio {
  id: string;
  name: string;
  growthRate: number;
  realization: AccountRealization;
  mix: AccountAssetMix[];
}

/** Mirrors resolve-entity.ts (model-portfolio account path), which sets
 *  growthRate = geoReturn and turnoverPct = 0. */
export function growthAndRealizationFromPortfolio(p: ResolvedGrowth): {
  growthRate: number;
  realization: AccountRealization;
} {
  return {
    growthRate: p.geoReturn,
    realization: {
      pctOrdinaryIncome: p.pctOi,
      pctLtCapitalGains: p.pctLtcg,
      pctQualifiedDividends: p.pctQdiv,
      pctTaxExempt: p.pctTaxEx,
      turnoverPct: 0,
    },
  };
}

/** Mirrors load-monte-carlo-data.ts (parseFloat on the decimal weight). */
export function mixFromAllocationRows(
  rows: ReadonlyArray<{ assetClassId: string; weight: string }>,
): AccountAssetMix[] {
  return rows.map((r) => ({ assetClassId: r.assetClassId, weight: parseFloat(r.weight) }));
}

/** Combine `{ id, name }` rows, a portfolioId→allocation-rows map, and a
 *  resolvePortfolio function into the client-facing SolverModelPortfolio list. */
export function assembleSolverPortfolios(
  rows: ReadonlyArray<{ id: string; name: string }>,
  allocsByPortfolio: ReadonlyMap<string, ReadonlyArray<{ assetClassId: string; weight: string }>>,
  resolvePortfolio: (id: string) => ResolvedGrowth,
): SolverModelPortfolio[] {
  return rows.map((row) => {
    const { growthRate, realization } = growthAndRealizationFromPortfolio(resolvePortfolio(row.id));
    return {
      id: row.id,
      name: row.name,
      growthRate,
      realization,
      mix: mixFromAllocationRows(allocsByPortfolio.get(row.id) ?? []),
    };
  });
}
