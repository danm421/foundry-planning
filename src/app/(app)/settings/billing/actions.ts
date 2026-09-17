"use server";

import { auth } from "@clerk/nextjs/server";
import { requireBillingContact } from "@/lib/authz";
import {
  buildCheckoutSessionParams,
  PLAN_PRICE_KEY,
  normalizePlan,
} from "@/lib/billing/checkout";
import { getStripe } from "@/lib/billing/stripe-client";
import { getSubscriptionState } from "@/lib/billing/subscription-state";
import { checkCheckoutSessionRateLimit } from "@/lib/rate-limit";

type ActionResult = { ok: true; url: string } | { ok: false; error: string };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

/**
 * Start Checkout for a firm that ALREADY has an org — the self-serve way back
 * from an ended Founder comp. Until this existed, `/settings/billing` had no
 * subscribe button at all for an existing org, so a de-comped firm's only
 * on-screen option was "contact support".
 *
 * Gated to `comp_ended` on purpose, and narrowly:
 *
 *  - `missing` is an unprovisioned/broken account. Offering it checkout could
 *    mint a duplicate subscription for a firm whose metadata merely failed to
 *    write — the wrong remedy for that population, which is exactly why
 *    `comp_ended` is a distinct state rather than a reuse of `missing`.
 *  - a canceled or past_due firm already has a Stripe customer, so its route
 *    back is the billing portal ("Manage billing"), not a second subscription.
 *
 * The session is bound to this org via `existingFirmId`. That binding is load
 * bearing, not bookkeeping: `checkout-session-completed` otherwise reuses a
 * firm only by looking up its Stripe customer id, which finds nothing for a
 * firm comped before it ever subscribed — and then mints a SECOND Clerk org,
 * stranding every client in the first one.
 */
export async function startResubscribeCheckout(
  formData: FormData,
): Promise<ActionResult> {
  await requireBillingContact();
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return { ok: false, error: "You need to be signed in." };

  const state = await getSubscriptionState();
  if (state.kind !== "comp_ended") {
    return { ok: false, error: "This account isn't waiting on a subscription." };
  }

  // Same bucket, and the same user-keyed rationale, as the signup path's
  // `startSignupCheckout`.
  const rl = await checkCheckoutSessionRateLimit(`user:${userId}`);
  if (!rl.allowed) {
    return { ok: false, error: "Too many attempts. Please wait a moment and try again." };
  }

  const plan = normalizePlan(String(formData.get("plan") ?? ""));

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        priceKey: PLAN_PRICE_KEY[plan],
        origin: appUrl(),
        clientReferenceId: userId,
        existingFirmId: orgId,
      }),
    );
    if (!session.url) throw new Error("Stripe returned a session with no URL");
    return { ok: true, url: session.url };
  } catch (err) {
    // Never let a Stripe failure escape a server action — an uncaught throw
    // takes out the page via the error boundary, and this page IS the recovery
    // surface for a firm that can't edit anything.
    console.error("[billing] could not start re-subscribe Checkout:", err);
    return { ok: false, error: "We couldn't reach payments. Please try again in a moment." };
  }
}
