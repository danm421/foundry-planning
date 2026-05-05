import type Stripe from "stripe";
import { getPriceCatalog, type PriceCatalog } from "./price-catalog";

export type CheckoutPriceKey = Extract<
  keyof PriceCatalog,
  "seatMonthly" | "seatAnnual"
>;

// Stripe SDK exposes the create-params type as a type alias on the Checkout
// namespace, which strips its inner namespaces — so `Stripe.Checkout
// .SessionCreateParams.LineItem` no longer resolves. Derive it via Parameters
// instead, which routes through the Sessions module's full namespace.
type SessionCreateParams = NonNullable<
  Parameters<Stripe["checkout"]["sessions"]["create"]>[0]
>;
type SessionLineItem = NonNullable<SessionCreateParams["line_items"]>[number];

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
}): SessionCreateParams {
  const catalog = getPriceCatalog();
  const priceId = catalog[args.priceKey];
  const line_items: SessionLineItem[] = [{ price: priceId, quantity: 1 }];
  if (args.withAiImport) {
    line_items.push({ price: catalog.aiImportMonthly, quantity: 1 });
  }
  // Stripe's consent_collection.terms_of_service is intentionally NOT used.
  // Our app-side acceptance trail is stronger: /legal/tos page + per-checkout
  // tos_acceptances row (userId, firmId, version, IP, timestamp). The
  // checkout-session-completed handler always writes that row when the
  // checkout completes, so consent is always recorded.
  return {
    mode: "subscription",
    line_items,
    subscription_data: { trial_period_days: 14 },
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
