import type Stripe from "stripe";
import { getPriceCatalog, type PriceCatalog } from "./price-catalog";

export type CheckoutPriceKey = Extract<
  keyof PriceCatalog,
  "seatMonthly" | "seatAnnual"
>;

/**
 * Build the Stripe Checkout session params for a public buyer flow.
 * Pure function — no Stripe API calls, no DB. The route handler wraps
 * this with stripe.checkout.sessions.create().
 *
 * `priceKey` is constrained to public seat prices; the founding-annual
 * path is sales-only (manual via the runbook) and intentionally not
 * reachable from this code path.
 */
export function buildCheckoutSessionParams(args: {
  priceKey: CheckoutPriceKey;
  origin: string;
  withAiImport?: boolean;
}): Stripe.Checkout.SessionCreateParams {
  const catalog = getPriceCatalog();
  const priceId = catalog[args.priceKey];
  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: priceId, quantity: 1 },
  ];
  if (args.withAiImport) {
    line_items.push({ price: catalog.aiImportMonthly, quantity: 1 });
  }
  return {
    mode: "subscription",
    line_items,
    subscription_data: { trial_period_days: 14 },
    consent_collection: { terms_of_service: "required" },
    custom_fields: [
      {
        key: "firm_name",
        label: { type: "custom", custom: "Firm Name" },
        type: "text",
      },
    ],
    automatic_tax: { enabled: true },
    success_url: `${args.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.origin}/pricing`,
    payment_method_types: ["card"],
  };
}
