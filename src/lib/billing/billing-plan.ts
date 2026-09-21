import { getPriceCatalog } from "./price-catalog";

export type BillingPlan = "monthly" | "annual";

export function billingPlanForPriceId(priceId: string): BillingPlan | null {
  const catalog = getPriceCatalog();
  if (priceId === catalog.seatMonthly) return "monthly";
  if (priceId === catalog.seatAnnual) return "annual";
  return null;
}
