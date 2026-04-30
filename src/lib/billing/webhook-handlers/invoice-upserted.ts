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

  const firmId = (inv.metadata as Record<string, string | undefined> | null)
    ?.firm_id;
  if (!firmId || !customerId) {
    throw new Error(`invoice ${inv.id} missing firm_id or customer`);
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
  if (event.type === "invoice.paid" && subId) {
    const subRows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subId));
    const parent = subRows[0];
    if (parent?.status === "past_due") {
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
