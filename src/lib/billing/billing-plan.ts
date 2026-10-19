import { getPriceCatalog } from "./price-catalog";

export type BillingPlan = "monthly" | "annual";

// A retired seat price still bills the firms left on it (the $199 / $1,990
// seats from before the 2026-10 price cut), so their plan must still be named
// or the billing page and the cycle switch lose sight of them. Optional: the
// catalog is what we sell, these are only what we still recognize.
function isLegacy(priceId: string, envKey: string): boolean {
  const legacy = process.env[envKey];
  return !!legacy && priceId === legacy;
}

export function billingPlanForPriceId(priceId: string): BillingPlan | null {
  const catalog = getPriceCatalog();
  if (priceId === catalog.seatMonthly || isLegacy(priceId, "STRIPE_PRICE_ID_SEAT_MONTHLY_LEGACY")) {
    return "monthly";
  }
  if (priceId === catalog.seatAnnual || isLegacy(priceId, "STRIPE_PRICE_ID_SEAT_ANNUAL_LEGACY")) {
    return "annual";
  }
  return null;
}
