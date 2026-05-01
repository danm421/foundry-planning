import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions, firms } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * customer.subscription.deleted — sets status to canceled, archives the firm,
 * and starts the 90-day retention countdown. Read-endpoint grace (30d) is
 * enforced by middleware reading firms.archived_at + Clerk metadata —
 * webhook just records the event.
 */
export async function handleSubscriptionDeleted(
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

  const now = new Date();
  await db
    .update(subscriptions)
    .set({
      status: "canceled",
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : now,
      updatedAt: now,
    })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id));

  await db
    .update(firms)
    .set({
      archivedAt: now,
      dataRetentionUntil: new Date(now.getTime() + RETENTION_MS),
      updatedAt: now,
    })
    .where(eq(firms.firmId, firmId));

  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: {
      subscription_status: "canceled",
      archived_at: now.toISOString(),
    },
  });

  await recordAudit({
    action: "billing.canceled",
    resourceType: "subscription",
    resourceId: sub.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: { canceled_at: now.toISOString() },
  });
}
