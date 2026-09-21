import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { requireBillingContact, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal — opens Stripe's Dashboard-managed Customer Portal
 * for cards, invoices and cancellation.
 *
 * Billing-CYCLE changes deliberately do NOT go through here any more. Stripe
 * ignores `features.subscription_update.schedule_at_period_end.conditions`
 * inside a `flow_data type=subscription_update_confirm` session — the
 * conditions read back from Stripe as present and do nothing, and the portal
 * times the switch off `proration_behavior` instead. Measured 2026-09-21: a
 * paid $1,990 annual subscription pressing "Switch to monthly" re-anchored
 * from 2027-09-21 to 2026-10-21 immediately, with no credit note and no
 * credit balance — $1,791 of paid service destroyed. `create_prorations` is
 * not a remedy either: it credits the downgrade and charges $3,781 today on
 * the upgrade. The flow accepts only `subscription`, `items` and `discounts`,
 * so no configuration fixes it.
 *
 * Cycle changes are owned by the app now — see
 * `src/lib/billing/plan-switch.ts` and `/settings/billing/switch`.
 */

// Keep all return URLs on the configured app origin.
function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

// Native form submissions need a page with an explanation, not a JSON body.
function billingError(code: string): Response {
  return NextResponse.redirect(
    `${appOrigin()}/settings/billing?billing_error=${code}`,
    303,
  );
}

export async function POST(): Promise<Response> {
  try {
    await requireBillingContact();
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
    throw err;
  }

  // firmId === Clerk org id.
  const { orgId } = await auth();
  if (!orgId) {
    return billingError("no_subscription");
  }

  const row = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, orgId))
    .orderBy(desc(subscriptions.createdAt))
    .then((r) => r[0]);

  const customer = row?.stripeCustomerId;
  if (!customer) {
    // Founder / never-purchased: no Stripe customer to manage.
    return billingError("no_subscription");
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${appOrigin()}/settings/billing`,
    });
    await recordAudit({
      action: "billing.portal_opened",
      resourceType: "subscription",
      resourceId: customer,
      firmId: orgId,
      metadata: { flow: "portal_home" },
    });
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[billing/portal] stripe error:", err);
    return billingError("portal_unavailable");
  }
}
