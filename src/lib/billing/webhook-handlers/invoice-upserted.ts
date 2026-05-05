import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { invoices, subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

/**
 * Shared handler for invoice.created, invoice.finalized, invoice.paid.
 * On each event we:
 *   - Re-fetch live invoice via Stripe.
 *   - Upsert the invoices row.
 *   - On invoice.paid: if parent subscription is past_due, flip it back to
 *     active + audit billing.payment_recovered. The Stripe webhook for
 *     subscription.updated will follow shortly and double-confirm.
 *
 * Stripe API v22 moved the parent subscription off the top-level
 * `subscription` field onto `parent.subscription_details.subscription`,
 * and `paid_at` lives on `status_transitions.paid_at`.
 */
export async function handleInvoiceUpserted(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const inv = await stripe.invoices.retrieve(
    (event.data.object as { id: string }).id,
  );

  const customerId =
    typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null;

  const rawSub = inv.parent?.subscription_details?.subscription ?? null;
  const subId =
    typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;

  if (!customerId || !subId) {
    // Subscription invoices always carry a customer + parent sub. Anything
    // without one isn't ours to record.
    console.warn(
      `[webhook] ${event.type} ${inv.id}: missing customer/subscription`,
    );
    return;
  }

  // Stripe doesn't propagate subscription.metadata onto invoices, so the first
  // invoice for a new sub has no firm_id. We resolve via the subscriptions
  // table and reuse the row for the past_due recovery check below — one DB
  // round-trip instead of two on invoice.paid.
  const subRow = await db
    .select({ firmId: subscriptions.firmId, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .then((r) => r[0]);
  const firmId = inv.metadata?.firm_id ?? subRow?.firmId ?? null;
  if (!firmId) {
    // Race: subscription row isn't in our DB yet. Stripe will redeliver
    // after checkout.session.completed lands.
    console.warn(
      `[webhook] ${event.type} ${inv.id}: can't resolve firm_id (sub=${subId})`,
    );
    return;
  }

  const paidAtTs = inv.status_transitions?.paid_at ?? null;

  await db
    .insert(invoices)
    .values({
      firmId,
      stripeInvoiceId: inv.id as string,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subId,
      status: inv.status ?? null,
      amountDue: inv.amount_due ?? null,
      amountPaid: inv.amount_paid ?? null,
      currency: inv.currency ?? null,
      periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
      paidAt: paidAtTs ? new Date(paidAtTs * 1000) : null,
    })
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        status: inv.status ?? null,
        amountPaid: inv.amount_paid ?? null,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        invoicePdf: inv.invoice_pdf ?? null,
        paidAt: paidAtTs ? new Date(paidAtTs * 1000) : null,
        updatedAt: new Date(),
      },
    });

  // Recovery path: invoice.paid + parent sub past_due → flip to active.
  // subRow was already fetched above; reuse it.
  if (event.type === "invoice.paid" && subId) {
    if (subRow?.status === "past_due") {
      await db
        .update(subscriptions)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId));
      const cc = await clerkClient();
      await cc.organizations.updateOrganizationMetadata(firmId, {
        publicMetadata: { subscription_status: "active" },
      });
      await recordAudit({
        action: "billing.payment_recovered",
        resourceType: "subscription",
        resourceId: subId,
        firmId,
        actorId: `stripe:webhook:${event.id}`,
        metadata: { invoice_id: inv.id ?? null },
      });
    }
  }
}
