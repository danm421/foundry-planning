import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

/**
 * customer.subscription.paused — read-only state per architecture spec
 * banner table. No archived_at, no retention countdown — paused is
 * recoverable, canceled is not.
 */
export async function handleSubscriptionPaused(
  event: Stripe.Event,
): Promise<void> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(
    (event.data.object as { id: string }).id,
  );
  const firmId = (sub.metadata as Record<string, string | undefined>).firm_id;
  if (!firmId) {
    throw new Error(`subscription ${sub.id} missing metadata.firm_id`);
  }

  await db
    .update(subscriptions)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id));

  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: { subscription_status: "paused" },
  });

  await recordAudit({
    action: "billing.subscription_updated",
    resourceType: "subscription",
    resourceId: sub.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: { event_kind: "paused" },
  });
}
