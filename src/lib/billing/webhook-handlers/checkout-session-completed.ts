import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  firms,
  subscriptions,
  subscriptionItems,
  tosAcceptances,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { deriveEntitlements } from "@/lib/billing/entitlements";
import { getActiveEntitlementOverrides } from "@/lib/ops/entitlements";
import { readSubscriptionItemMeta } from "@/lib/billing/subscription-item-meta";
import { recordAudit } from "@/lib/audit";

const TOS_VERSION_DEFAULT = "v1";

/**
 * checkout.session.completed — the entry point for new firms. Order of ops:
 *   1. Re-fetch session (for ToS consent + custom firm_name + customer/subscription IDs).
 *   2. Create Clerk org with the firm name from the custom field.
 *   3. Stamp Stripe subscription metadata.firm_id = newOrgId so subsequent
 *      subscription/invoice webhooks have firm context.
 *   4. Re-fetch the now-stamped subscription for full state.
 *   5. Send Clerk org-admin invitation for the buyer email.
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

  // 1. Idempotency: a redelivery after a partial failure must converge on the
  //    original firm, not mint a second Clerk org. Look up any subscription we
  //    already recorded for this Stripe customer; reuse its firmId if present.
  const existingSub = await db
    .select({ firmId: subscriptions.firmId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .then((r) => r[0]);

  let firmId: string;
  if (existingSub?.firmId) {
    firmId = existingSub.firmId;
  } else {
    const org = await cc.organizations.createOrganization({
      name: firmName,
    });
    firmId = org.id;
  }

  // 2. Stamp Stripe subscription with the firm_id so future webhooks resolve.
  await stripe.subscriptions.update(subId, {
    metadata: { firm_id: firmId },
  });

  // 3. Re-fetch the now-stamped subscription for full state.
  const sub = await stripe.subscriptions.retrieve(subId, {
    expand: ["items.data.price"],
  });

  // 4. Send org-admin invitation.
  await cc.organizations.createOrganizationInvitation({
    organizationId: firmId,
    emailAddress: buyerEmail,
    role: "org:admin",
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
        sub.items.data.map((it) => {
          const price = typeof it.price === "object" && it.price ? it.price : null;
          return {
            subscriptionId: internalSubId,
            firmId,
            stripeItemId: it.id,
            stripePriceId: price?.id ?? "",
            ...readSubscriptionItemMeta(it),
            quantity: it.quantity ?? 1,
            unitAmount: price?.unit_amount ?? 0,
            currency: price?.currency ?? "usd",
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: subscriptionItems.id });
  }

  // 6. ToS acceptance record. We don't use Stripe's consent_collection
  // (see note in checkout.ts) — completing Checkout is itself the acceptance,
  // and we record it unconditionally. The Clerk user.created webhook will
  // later write a second row with acceptance_source="clerk_signup".
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

  // 7. Set Clerk metadata. At checkout the line items aren't materialized in
  // this handler, so we derive from an empty item set — any pre-existing grant
  // override surfaces immediately; the subsequent customer.subscription.created
  // webhook recomputes entitlements with the real items + overrides.
  const overrides = await getActiveEntitlementOverrides(firmId);
  const entitlements = deriveEntitlements({ items: [], overrides });
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      entitlements,
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
