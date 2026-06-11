import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { sendBillingEmail } from "@/lib/billing/email-stub";
import { recordAudit } from "@/lib/audit";
import { resolveBillingContact } from "@/lib/billing/billing-contact";

/**
 * invoice.payment_action_required — 3DS / SCA flow needs user action.
 * No status change; Stripe Smart Retries owns retry. We notify the owner
 * with the Stripe-hosted recovery URL.
 *
 * Stripe doesn't propagate subscription.metadata onto invoices, so firm_id is
 * resolved via the subscriptions table (keyed by the parent subscription id);
 * inv.metadata.firm_id is honored only as an override. On a genuine "sub not
 * yet in our DB" race we warn + return so Stripe redelivers — never throw.
 */
export async function handleInvoicePaymentActionRequired(
  event: Stripe.Event,
): Promise<void> {
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

  const metaFirmId = (inv.metadata as Record<string, string | undefined> | null)
    ?.firm_id;
  const subRow = await db
    .select({ firmId: subscriptions.firmId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .then((r) => r[0]);
  const firmId = metaFirmId ?? subRow?.firmId ?? null;
  if (!firmId) {
    console.warn(
      `[webhook] ${event.type} ${inv.id}: can't resolve firm_id (sub=${subId})`,
    );
    return;
  }

  const contact = await resolveBillingContact(firmId);
  const email = contact?.email ?? null;
  if (email) {
    await sendBillingEmail({
      kind: "payment_action_required",
      to: email,
      firmId,
      payload: { invoiceUrl: inv.hosted_invoice_url ?? null, invoiceId: inv.id },
    });
  }
  await recordAudit({
    action: "billing.subscription_updated",
    resourceType: "invoice",
    resourceId: inv.id ?? "unknown",
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: { event_kind: "payment_action_required", invoice_id: inv.id },
  });
}
