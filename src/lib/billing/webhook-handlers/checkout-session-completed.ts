import type Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  firms,
  subscriptions,
  subscriptionItems,
  tosAcceptances,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

const TOS_VERSION_DEFAULT = "v1";

/**
 * checkout.session.completed — the entry point for new firms. Order of ops:
 *   1. Re-fetch session (for ToS consent + custom firm_name + customer/subscription IDs).
 *   2. Create Clerk org with the firm name from the custom field.
 *   3. Stamp Stripe subscription metadata.firm_id = newOrgId so subsequent
 *      subscription/invoice webhooks have firm context.
 *   4. Re-fetch the now-stamped subscription for full state.
 *   5. Send Clerk org-owner invitation for the buyer email.
 *   6. Insert firms + subscriptions + subscription_items + tos_acceptances rows.
 *   7. Set Clerk org public_metadata (subscription_status, entitlements: []).
 *   8. Audit billing.subscription_created.
 *
 * The clerk org invitation triggers the existing Clerk webhook chain; the
 * user.created webhook then writes the second tos_acceptances row with
 * acceptance_source: clerk_signup.
 */
export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(
    (event.data.object as { id: string }).id,
    { expand: ["customer_details", "custom_fields", "consent"] },
  );

  const firmName =
    session.custom_fields?.find((f) => f.key === "firm_name")?.text?.value ??
    "Unnamed Firm";
  const buyerEmail = session.customer_details?.email;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!buyerEmail || !customerId || !subId) {
    throw new Error(
      `checkout session ${session.id} missing buyer email, customer, or subscription`,
    );
  }

  const cc = await clerkClient();

  // 1. Create Clerk org.
  const org = await cc.organizations.createOrganization({
    name: firmName,
  });
  const firmId = org.id;

  // 2. Stamp Stripe subscription with the firm_id so future webhooks resolve.
  await stripe.subscriptions.update(subId, {
    metadata: { firm_id: firmId },
  });

  // 3. Re-fetch the now-stamped subscription for full state.
  const sub = await stripe.subscriptions.retrieve(subId, {
    expand: ["items.data.price"],
  });

  // 4. Send org-owner invitation.
  await cc.organizations.createOrganizationInvitation({
    organizationId: firmId,
    emailAddress: buyerEmail,
    role: "org:owner",
  });

  // Stripe API v22 moved current_period_* off Subscription onto each
  // SubscriptionItem to support multi-period subscriptions. For our
  // single-product subs the first item's period is authoritative.
  const firstItem = sub.items.data[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number | null;
        current_period_end?: number | null;
      })
    | undefined;
  const periodStart = firstItem?.current_period_start ?? null;
  const periodEnd = firstItem?.current_period_end ?? null;

  // 5. Insert DB rows.
  await db
    .insert(firms)
    .values({ firmId, displayName: firmName, isFounder: false })
    .onConflictDoNothing()
    .returning({ firmId: firms.firmId });

  const subRows = await db
    .insert(subscriptions)
    .values({
      firmId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      status: sub.status,
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    })
    .onConflictDoNothing()
    .returning({ id: subscriptions.id });

  const internalSubId = subRows[0]?.id;
  if (internalSubId && sub.items.data.length > 0) {
    await db
      .insert(subscriptionItems)
      .values(
        sub.items.data.map((it) => ({
          subscriptionId: internalSubId,
          firmId,
          stripeItemId: it.id,
          stripePriceId:
            typeof it.price === "string" ? it.price : it.price?.id ?? "",
          kind: ((it.metadata?.kind as "seat" | "addon") ?? "seat") as
            | "seat"
            | "addon",
          addonKey: it.metadata?.addon_key ?? null,
          quantity: it.quantity ?? 1,
          unitAmount:
            typeof it.price === "object" && it.price
              ? it.price.unit_amount ?? 0
              : 0,
          currency:
            typeof it.price === "object" && it.price
              ? it.price.currency
              : "usd",
        })),
      )
      .onConflictDoNothing()
      .returning({ id: subscriptionItems.id });
  }

  // 6. ToS acceptance record (Stripe Checkout source).
  if (session.consent?.terms_of_service === "accepted") {
    await db
      .insert(tosAcceptances)
      .values({
        userId: `stripe:${customerId}`, // pre-Clerk-user-creation placeholder
        firmId,
        tosVersion: TOS_VERSION_DEFAULT,
        acceptanceSource: "stripe_checkout",
      })
      .onConflictDoNothing()
      .returning({ id: tosAcceptances.id });
  }

  // 7. Set Clerk metadata.
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      entitlements: [],
      trial_ends_at: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
    },
  });

  // 8. Audit.
  await recordAudit({
    action: "billing.subscription_created",
    resourceType: "subscription",
    resourceId: sub.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: {
      buyer_email: buyerEmail,
      firm_name: firmName,
      checkout_session_id: session.id,
    },
  });
}
