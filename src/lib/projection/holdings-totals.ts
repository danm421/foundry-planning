import { rollupHoldings, type HoldingInput } from "@/lib/investments/holdings-rollup";

export interface HoldingsTotals {
  value: number;
  basis: number;
}

/** Per-account value+basis derived from holdings, for accounts that are driven
 *  by their holdings (deriveFromHoldings !== false AND ≥1 holding). Pure: callers
 *  pass already-loaded inputs. Mirrors how the deterministic and Monte Carlo
 *  loaders both need holdings-derived starting balances. */
export function computeHoldingsTotals(input: {
  accounts: ReadonlyArray<{ id: string; deriveFromHoldings: boolean | null }>;
  holdingsByAccountId: ReadonlyMap<string, HoldingInput[]>;
  slugToAssetClassId: ReadonlyMap<string, string>;
}): Map<string, HoldingsTotals> {
  const totals = new Map<string, HoldingsTotals>();
  for (const account of input.accounts) {
    if (account.deriveFromHoldings === false) continue;
    const list = input.holdingsByAccountId.get(account.id);
    if (!list || list.length === 0) continue;
    const rollup = rollupHoldings(list, input.slugToAssetClassId);
    totals.set(account.id, { value: rollup.value, basis: rollup.basis });
  }
  return totals;
}
