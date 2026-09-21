"use server";

import { redirect } from "next/navigation";
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
import { commitPlanSwitch, cancelPendingPlanSwitch } from "@/lib/billing/plan-switch";
import type { BillingPlan } from "@/lib/billing/billing-plan";

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

/**
 * Confirm a cycle change from the in-app screen. Nothing is due today on any
 * switch, so there is no payment to collect and no reason to hand the customer
 * to Stripe's hosted portal — which is also the surface that applies a paid
 * downgrade immediately and destroys the paid remainder.
 */
export async function confirmPlanSwitchAction(formData: FormData): Promise<void> {
  await requireBillingContact();
  const { orgId } = await auth();
  if (!orgId) redirect("/settings/billing?billing_error=no_subscription");

  const raw = String(formData.get("plan") ?? "");
  if (raw !== "monthly" && raw !== "annual") {
    redirect("/settings/billing?billing_error=invalid_plan");
  }
  const result = await commitPlanSwitch(orgId, raw as BillingPlan);
  if (!result.ok) {
    // Explicit map, not string interpolation: every code here must have an
    // entry in BILLING_NOTICES on the billing page, or the customer gets a
    // silent redirect with no explanation.
    const NOTICE: Record<typeof result.reason, string> = {
      unavailable: "plan_change_unavailable",
      already_on_plan: "already_on_plan",
      pending_exists: "plan_change_pending_exists",
      not_switchable: "plan_change_not_switchable",
    };
    redirect(`/settings/billing?billing_error=${NOTICE[result.reason]}`);
  }
  // No outcome is encoded in this redirect: the billing page re-reads the live
  // state from Stripe and renders whatever actually happened.
  redirect("/settings/billing");
}

export async function cancelPlanSwitchAction(): Promise<void> {
  await requireBillingContact();
  const { orgId } = await auth();
  if (!orgId) redirect("/settings/billing?billing_error=no_subscription");
  const result = await cancelPendingPlanSwitch(orgId);
  redirect(result.ok ? "/settings/billing" : "/settings/billing?billing_error=cancel_failed");
}
