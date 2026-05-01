import type Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms, subscriptions, subscriptionItems } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import {
  deriveEntitlements,
  type StripeItemView,
} from "@/lib/billing/entitlements";
import { recordAudit } from "@/lib/audit";

/**
 * Handler for customer.subscription.created and customer.subscription.updated.
 * Both events share this code path: re-fetch live → upsert DB → sync Clerk
 * metadata → audit.
 *
 * Stripe is the source of truth: we never trust event.data.object — we
 * always retrieve the live object via Stripe API. Adds one round-trip per
 * webhook in exchange for ordering-safety.
 *
 * Founder org bypass is NOT here; founder orgs have no Stripe subscription
 * mapped, so this handler simply isn't fired for them.
 */
export async function handleSubscriptionUpsert(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const sub = (await stripe.subscriptions.retrieve(
    (event.data.object as { id: string }).id,
    { expand: ["items.data.price"] },
  )) as Stripe.Subscription & {
    metadata: Record<string, string | undefined>;
  };

  const firmId = sub.metadata.firm_id;
  if (!firmId) {
    throw new Error(
      `subscription ${sub.id} missing metadata.firm_id — set on Checkout session creation`,
    );
  }

  const firmRow = await db
    .select({ aiImportsUsed: firms.aiImportsUsed })
    .from(firms)
    .where(eq(firms.firmId, firmId))
    .then((r) => r[0]);
  const aiImportsUsed = firmRow?.aiImportsUsed ?? 0;

  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

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

  const itemsView: StripeItemView[] = sub.items.data.map((it) => ({
    kind: ((it.metadata?.kind as "seat" | "addon") ?? "seat") as
      | "seat"
      | "addon",
    addonKey: it.metadata?.addon_key ?? null,
    removed: false,
  }));
  const entitlements = deriveEntitlements({ items: itemsView, aiImportsUsed });

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
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        status: sub.status,
        currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: subscriptions.id });

  const internalSubId = subRows[0].id;

  if (sub.items.data.length > 0) {
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
            typeof it.price === "object" && it.price ? it.price.currency : "usd",
        })),
      )
      .onConflictDoUpdate({
        target: subscriptionItems.stripeItemId,
        set: { quantity: subscriptionItems.quantity, updatedAt: new Date() },
      })
      .returning({ id: subscriptionItems.id });
  }

  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      current_period_end: periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null,
      trial_ends_at: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
      entitlements,
    },
  });

  await recordAudit({
    action:
      event.type === "customer.subscription.created"
        ? "billing.subscription_created"
        : "billing.subscription_updated",
    resourceType: "subscription",
    resourceId: sub.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: { status: sub.status, item_count: sub.items.data.length },
  });
}
