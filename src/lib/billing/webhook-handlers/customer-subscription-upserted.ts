import type Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { firms, subscriptions, subscriptionItems } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import {
  deriveEntitlements,
  type StripeItemView,
} from "@/lib/billing/entitlements";
import { getActiveEntitlementOverrides } from "@/lib/ops/entitlements";
import { readSubscriptionItemMeta } from "@/lib/billing/subscription-item-meta";
import { recordAudit } from "@/lib/audit";

// The partial unique index subscriptions_firm_active_unique only indexes rows in
// these "live" statuses, so only another LIVE row can collide. A canceled prior
// subscription (cancel-then-resubscribe) must NOT count as a double-subscription.
const LIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "unpaid"];

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

  // Race tolerance: subscription.created/updated can fire before
  // checkout.session.completed has stamped sub.metadata.firm_id and committed
  // the firms row. No-op so Stripe redelivers after the firms row lands;
  // otherwise the FK on subscriptions.firm_id would throw.
  const firmId = sub.metadata.firm_id;
  if (!firmId) {
    console.warn(`[webhook] ${event.type} ${sub.id}: missing metadata.firm_id`);
    return;
  }
  const firmRow = await db
    .select({ firmId: firms.firmId })
    .from(firms)
    .where(eq(firms.firmId, firmId))
    .then((r) => r[0]);
  if (!firmRow) {
    console.warn(`[webhook] ${event.type} ${sub.id}: firm ${firmId} not in DB yet`);
    return;
  }

  // In-firm double-subscription guard. The subscriptions_firm_active_unique
  // partial index forbids two live rows per firm; if a second active sub with a
  // different id arrives (e.g. a duplicate Checkout), upserting it would throw a
  // 23505 → unhandled 500. Detect it, page ops, and skip rather than crash the
  // webhook. Reconcile/manual cleanup picks the survivor.
  const conflicting = await db
    .select({
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.firmId, firmId),
        ne(subscriptions.stripeSubscriptionId, sub.id),
      ),
    )
    .then((rows) =>
      rows.find((r) => LIVE_SUBSCRIPTION_STATUSES.includes(r.status)),
    );
  if (conflicting && LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    Sentry.captureMessage("Firm has a second active Stripe subscription", {
      level: "error",
      extra: {
        firmId,
        incomingSubscriptionId: sub.id,
        existingSubscriptionId: conflicting.stripeSubscriptionId,
        status: sub.status,
      },
    });
    console.error(
      `[webhook] ${event.type} ${sub.id}: firm ${firmId} already has active sub ${conflicting.stripeSubscriptionId} — skipping to avoid unique-index 500`,
    );
    return;
  }

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
    ...readSubscriptionItemMeta(it),
    removed: false,
  }));
  const overrides = await getActiveEntitlementOverrides(firmId);
  const entitlements = deriveEntitlements({ items: itemsView, overrides });

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
        sub.items.data.map((it) => {
          const price =
            typeof it.price === "object" && it.price ? it.price : null;
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
      .onConflictDoUpdate({
        target: subscriptionItems.stripeItemId,
        set: { quantity: subscriptionItems.quantity, updatedAt: new Date() },
      })
      .returning({ id: subscriptionItems.id });
  }

  const cc = await clerkClient();
  await Promise.all([
    cc.organizations.updateOrganizationMetadata(firmId, {
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
    }),
    recordAudit({
      action:
        event.type === "customer.subscription.created"
          ? "billing.subscription_created"
          : "billing.subscription_updated",
      resourceType: "subscription",
      resourceId: sub.id,
      firmId,
      actorId: `stripe:webhook:${event.id}`,
      metadata: { status: sub.status, item_count: sub.items.data.length },
    }),
  ]);
}
