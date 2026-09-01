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

// Pricing lives on the marketing site, not in the app. Cancelling out of
// Stripe has to land back where the buyer started; `${origin}/pricing` would
// 404 them on app.foundryplanning.com, which has no such route.
const STOREFRONT_PRICING_URL = "https://foundryplanning.com/pricing";

/**
 * The plan vocabulary the storefront speaks. Its pricing toggle emits
 * `?plan=annual` and `?plan=monthly`; its nav button emits neither. Annual is
 * the price the site shows by default, so an unnamed — or unrecognized — plan
 * resolves to annual rather than erroring a buyer out of the funnel.
 *
 * Shared by /sign-up and /api/checkout/start (which only forward the choice
 * along) and /welcome's `startSignupCheckout` (which prices it), so none of
 * them can disagree about what a plan is.
 */
export type CheckoutPlan = "annual" | "monthly";

export function normalizePlan(raw: string | string[] | undefined | null): CheckoutPlan {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "monthly" ? "monthly" : "annual";
}

export const PLAN_PRICE_KEY: Record<CheckoutPlan, CheckoutPriceKey> = {
  annual: "seatAnnual",
  monthly: "seatMonthly",
};

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
  /**
   * The Clerk userId of the signed-in buyer, on the self-serve path. Its
   * presence is what tells `checkout-session-completed` to add this person to
   * the new org directly instead of emailing an invitation. Omitted by the
   * sales path (`docs/founding-pricing-runbook.md`), which has no Clerk user
   * yet — that path keeps the Stripe custom field + invitation.
   */
  clientReferenceId?: string;
}): SessionCreateParams {
  const catalog = getPriceCatalog();
  const priceId = catalog[args.priceKey];
  const line_items: SessionLineItem[] = [{ price: priceId, quantity: 1 }];
  // Stripe's consent_collection.terms_of_service is intentionally NOT used.
  // Our app-side acceptance trail is stronger: /legal/tos page + per-checkout
  // tos_acceptances row (userId, firmId, version, IP, timestamp). The
  // checkout-session-completed handler always writes that row when the
  // checkout completes, so consent is always recorded.
  //
  // The firm name is NOT collected here. /welcome collects it, where it can be
  // validated and a typo is fixable, and stashes it for the webhook.
  return {
    mode: "subscription",
    line_items,
    subscription_data: { trial_period_days: 14 },
    ...(args.clientReferenceId
      ? { client_reference_id: args.clientReferenceId }
      : {}),
    automatic_tax: { enabled: true },
    // Not about shipping — this is what makes Apple Pay and Google Pay appear.
    // Stripe hides both wallets on any Checkout Session that uses Stripe Tax
    // unless a shipping address is collected (or the customer already has one
    // saved). Stripe's docs name only Google Pay; measured 2026-09-01 on two
    // otherwise-identical test sessions, Apple Pay is hidden by the same rule —
    // without this line the express row is Link alone.
    //
    // The visible cost: Checkout retitles its first section "Shipping
    // information" and requires a full name + address. Hosted Checkout gives no
    // way to relabel it. Accepted deliberately to get the wallets.
    //
    // US-only because the product is US-only (federal + state tax, Social
    // Security, US estate rules) and Stripe Tax is registered per US state.
    // Note this is a narrowing: billing-address collection accepted any
    // country, so a non-US buyer can no longer self-serve.
    shipping_address_collection: { allowed_countries: ["US"] },
    // /admin/promo-codes mints Stripe promotion codes for buyers to type here.
    // Without this the field never renders and every code ops issues is dead.
    allow_promotion_codes: true,
    success_url: `${args.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: STOREFRONT_PRICING_URL,
    // Pinned on purpose, and pinning is the only lever there is: Stripe has no
    // deny-list. Naming payment_method_types OVERRIDES dynamic payment methods —
    // Checkout offers exactly this list and ignores every other method the
    // Dashboard has enabled. Left unset, Stripe resolved
    // ["card","klarna","link","cashapp","amazon_pay"], putting buy-now-pay-later
    // in front of advisors buying a business subscription.
    //
    // Apple Pay and Google Pay have no enum of their own — they ride on "card",
    // so this list neither enables nor blocks them. What does gate them is
    // shipping_address_collection above plus their Dashboard toggles, under
    // Settings -> Payment methods.
    //
    // Cost of pinning: a method enabled in the Dashboard later needs a deploy
    // to appear here.
    payment_method_types: ["card", "us_bank_account"],
  };
}
