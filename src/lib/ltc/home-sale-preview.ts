import type { ClientData, LtcHomeSale, ProjectionYear } from "@/engine/types";

/** What the LTC home sale would bring in. Reads the sale year's BEGINNING
 *  values — the projection records them before that year's sales run, so
 *  this is correct even when the sale is already on (pinned in
 *  ltc-projection.test.ts). A figure the projection can't supply is null
 *  ("—"), never $0. */
export function homeSalePreview(
  years: ProjectionYear[],
  tree: ClientData,
  sale: LtcHomeSale,
): { projectedValue: number | null; mortgageLeft: number | null; sellingCosts: number | null; cashToHousehold: number | null } {
  const y = years.find((p) => p.year === sale.saleYear);
  const home = y?.accountLedgers[sale.accountId];
  const projectedValue = home?.beginningValue ?? null;
  // Unknown, not $0, when the projection does not run that year or no longer
  // holds the home or one of its loans that year (e.g. the dialog previews
  // against the plan as saved, which already sold the home earlier).
  const loans = tree.liabilities.filter((l) => l.linkedPropertyId === sale.accountId);
  const mortgageLeft =
    y && home && loans.every((l) => y.liabilityBalancesBoY[l.id] != null)
      ? loans.reduce((sum, l) => sum + y.liabilityBalancesBoY[l.id], 0)
      : null;
  const price = sale.price.mode === "custom" ? sale.price.amount : projectedValue;
  if (price == null) return { projectedValue, mortgageLeft, sellingCosts: null, cashToHousehold: null };
  const sellingCosts = price * sale.sellingCostPct;
  return {
    projectedValue,
    mortgageLeft,
    sellingCosts,
    cashToHousehold: mortgageLeft == null ? null : price - sellingCosts - mortgageLeft,
  };
}
