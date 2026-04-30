import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { sendBillingEmail } from "@/lib/billing/email-stub";
import { recordAudit } from "@/lib/audit";

/**
 * invoice.payment_failed — flips parent subscription to past_due so Phase 2's
 * SubscriptionGuard banner activates. Email-stub queues the recovery email.
 * Stripe Smart Retries owns the retry cadence; we only react to events.
 *
 * Stripe API v22 moved the subscription pointer off Invoice onto
 * `parent.subscription_details.subscription`. We probe both locations so
 * historic fixtures and live v22 payloads both resolve.
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const inv = (await stripe.invoices.retrieve(
    (event.data.object as { id: string }).id,
  )) as Stripe.Invoice & {
    // v22 surfaces the link under parent.subscription_details; legacy code
    // (and our tests) still attach it directly. Accept either.
    subscription?: string | Stripe.Subscription | null;
  };

  const legacySub = inv.subscription;
  const parentSub = inv.parent?.subscription_details?.subscription ?? null;
  const rawSub = legacySub ?? parentSub;
  const subId =
    typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;
  const firmId = (inv.metadata as Record<string, string | undefined> | null)
    ?.firm_id;
  if (!subId || !firmId) {
    throw new Error(`invoice ${inv.id} missing subscription or firm_id`);
  }

  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, subId));

  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: { subscription_status: "past_due" },
  });

  // Notify org owner.
  const members = await cc.organizations.getOrganizationMembershipList({
    organizationId: firmId,
    limit: 100,
  });
  const owner = members.data.find((m) => m.role === "org:owner");
  const email = owner?.publicUserData?.identifier;
  if (email) {
    await sendBillingEmail({
      kind: "payment_failed",
      to: email,
      firmId,
      payload: { invoiceUrl: inv.hosted_invoice_url ?? null, invoiceId: inv.id },
    });
  }

  await recordAudit({
    action: "billing.payment_failed",
    resourceType: "invoice",
    resourceId: inv.id ?? "unknown",
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: { invoice_id: inv.id, subscription_id: subId },
  });
}
