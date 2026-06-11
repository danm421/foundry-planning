import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { sendBillingEmail } from "@/lib/billing/email-stub";
import { recordAudit } from "@/lib/audit";
import { resolveBillingContact } from "@/lib/billing/billing-contact";

/**
 * invoice.payment_failed — flips parent subscription to past_due so the
 * SubscriptionGuard banner activates. Email-stub queues the recovery email.
 * Stripe Smart Retries owns the retry cadence; we only react to events.
 *
 * Stripe doesn't propagate subscription.metadata onto invoices, so firm_id is
 * resolved via the subscriptions table (keyed by the parent subscription id);
 * inv.metadata.firm_id is honored only as an override. On a genuine "sub not
 * yet in our DB" race we warn + return so Stripe redelivers — never throw.
 *
 * Stripe API v22 moved the subscription pointer off Invoice onto
 * `parent.subscription_details.subscription`; we probe both locations.
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const inv = (await stripe.invoices.retrieve(
    (event.data.object as { id: string }).id,
  )) as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };

  const legacySub = inv.subscription;
  const parentSub = inv.parent?.subscription_details?.subscription ?? null;
  const rawSub = legacySub ?? parentSub;
  const subId =
    typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;
  if (!subId) {
    console.warn(
      `[webhook] ${event.type} ${inv.id}: missing subscription pointer`,
    );
    return;
  }

  // Resolve firm via the subscriptions table; metadata.firm_id is override-only.
  const metaFirmId = (inv.metadata as Record<string, string | undefined> | null)
    ?.firm_id;
  const subRow = await db
    .select({ firmId: subscriptions.firmId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .then((r) => r[0]);
  const firmId = metaFirmId ?? subRow?.firmId ?? null;
  if (!firmId) {
    // Race: subscription row isn't in our DB yet. Stripe redelivers after
    // checkout.session.completed lands.
    console.warn(
      `[webhook] ${event.type} ${inv.id}: can't resolve firm_id (sub=${subId})`,
    );
    return;
  }

  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, subId));

  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: { subscription_status: "past_due" },
  });

  // Notify billing contact.
  const contact = await resolveBillingContact(firmId);
  const email = contact?.email ?? null;
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
