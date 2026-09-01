import { NextResponse } from "next/server";
import {
  buildCheckoutSessionParams,
  normalizePlan,
  PLAN_PRICE_KEY,
} from "@/lib/billing/checkout";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutSessionRateLimit, extractClientIp } from "@/lib/rate-limit";

/**
 * The storefront's "Start trial" buttons land here, as does /sign-up for
 * anyone arriving without a Clerk invitation. Mints a Stripe Checkout session
 * for a 14-day trial and hands the buyer to Stripe; completing it fires
 * checkout.session.completed, which is what actually creates the firm and
 * emails the buyer their sign-in invitation.
 *
 * Unauthenticated by design — the buyer has no account yet. That is also why
 * it is IP rate-limited: without a session there is nothing else to key on.
 */

export const dynamic = "force-dynamic";

/** Read per-request, not at module load, so tests and previews see their own. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

/**
 * A buyer arrives here by clicking a link, so every failure has to land them
 * on a page rather than a status code they can't read. "Try again in a moment"
 * is the right advice whether Stripe is down, the environment is missing its
 * price IDs, or they tripped the rate limit — so all three share one exit.
 * The reason goes to the logs, never to the buyer.
 */
function unavailable(): NextResponse {
  return NextResponse.redirect(new URL("/checkout/unavailable", appUrl()), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const rl = await checkCheckoutSessionRateLimit(extractClientIp(req));
  if (!rl.allowed) {
    console.warn("[checkout/start] rate limited:", rl.reason);
    return unavailable();
  }

  const plan = normalizePlan(new URL(req.url).searchParams.get("plan"));

  try {
    const stripe = getStripe();
    // buildCheckoutSessionParams throws if a price ID is missing from the
    // environment, so it belongs inside the try alongside the API call.
    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({ priceKey: PLAN_PRICE_KEY[plan], origin: appUrl() }),
    );
    if (!session.url) throw new Error("Stripe returned a session with no URL");
    // no-store is load-bearing: a cached redirect would funnel every later
    // visitor into the first buyer's Checkout session.
    return NextResponse.redirect(session.url, {
      status: 303,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[checkout/start] could not start Checkout:", err);
    return unavailable();
  }
}
