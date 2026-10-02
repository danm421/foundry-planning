import type { ClientData, LtcHomeSale, ProjectionYear } from "@/engine/types";

/** What the LTC home sale would bring in. Reads the sale year's BEGINNING
 *  values — the projection records them before that year's sales run, so
 *  this is correct even when the sale is already on (pinned in
 *  ltc-projection.test.ts). */
export function homeSalePreview(
  years: ProjectionYear[],
  tree: ClientData,
  sale: LtcHomeSale,
): { projectedValue: number | null; mortgageLeft: number | null; sellingCosts: number; cashToHousehold: number | null } {
  const y = years.find((p) => p.year === sale.saleYear);
  const projectedValue = y?.accountLedgers[sale.accountId]?.beginningValue ?? null;
  // A year the projection does not run has no balances to read: the mortgage is
  // unknown, which is not the same as $0.
  const mortgageLeft = y
    ? tree.liabilities
        .filter((l) => l.linkedPropertyId === sale.accountId)
        .reduce((sum, l) => sum + (y.liabilityBalancesBoY[l.id] ?? 0), 0)
    : null;
  const price = sale.price.mode === "custom" ? sale.price.amount : projectedValue;
  if (price == null || mortgageLeft == null) return { projectedValue, mortgageLeft, sellingCosts: 0, cashToHousehold: null };
  const sellingCosts = price * sale.sellingCostPct;
  return { projectedValue, mortgageLeft, sellingCosts, cashToHousehold: price - sellingCosts - mortgageLeft };
}
