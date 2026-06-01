import {
  LIQUID_CATEGORIES,
  type AccountCategory,
} from "@/lib/account-groups/liquid-filter";

/** Normalized account view for the Monte Carlo starting-liquid-balance sum. */
export interface LiquidAccountInput {
  id: string;
  category: string;
  value: number;
  /** Owning entity id, or null for household-owned (always in-estate). */
  entityId: string | null;
}

/**
 * Sums the starting liquid portfolio value used as the Monte Carlo CAGR
 * reference (denominator in `summarizeMonteCarlo`). An account counts when its
 * category is liquid AND it is in-estate (household-owned, or owned by an
 * entity whose `includeInPortfolio` is true). A holdings-derived value, when
 * present for the account id, overrides the account's own `value`.
 *
 * Pure — callers supply the account view, the entity-in-portfolio map, and the
 * holdings-value map. The base path builds these from base DB rows; the
 * per-scenario path builds the account view + entity map from the effective
 * tree (the holdings map stays base-keyed).
 */
export function computeStartingLiquidBalance(
  accounts: ReadonlyArray<LiquidAccountInput>,
  entityInPortfolio: ReadonlyMap<string, boolean>,
  holdingsValueByAccountId: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const a of accounts) {
    // Liquid (investable, estate-included) only — real estate / business / life
    // insurance can't be liquidated to cover a shortfall (eMoney whitepaper
    // p.11). LIQUID_CATEGORIES is the canonical set in liquid-filter.ts.
    if (!LIQUID_CATEGORIES.has(a.category as AccountCategory)) continue;
    const inEstate = a.entityId == null || entityInPortfolio.get(a.entityId) === true;
    if (!inEstate) continue;
    total += holdingsValueByAccountId.get(a.id) ?? a.value;
  }
  return total;
}
