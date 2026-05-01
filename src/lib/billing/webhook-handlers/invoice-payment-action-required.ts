import type Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";
import { getStripe } from "@/lib/billing/stripe-client";
import { sendBillingEmail } from "@/lib/billing/email-stub";
import { recordAudit } from "@/lib/audit";

/**
 * invoice.payment_action_required — 3DS / SCA flow needed user action.
 * No status change; Stripe Smart Retries owns retry. We notify the owner
 * with the Stripe-hosted recovery URL.
 */
export async function handleInvoicePaymentActionRequired(
  event: Stripe.Event,
): Promise<void> {
  const stripe = getStripe();
  const inv = await stripe.invoices.retrieve(
    (event.data.object as { id: string }).id,
  );
  const firmId = (inv.metadata as Record<string, string | undefined>).firm_id;
  if (!firmId) {
    throw new Error(`invoice ${inv.id} missing firm_id`);
  }
  const cc = await clerkClient();
  const members = await cc.organizations.getOrganizationMembershipList({
    organizationId: firmId,
    limit: 100,
  });
  const owner = members.data.find((m) => m.role === "org:owner");
  const email = owner?.publicUserData?.identifier;
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
    resourceId: inv.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: { event_kind: "payment_action_required", invoice_id: inv.id },
  });
}
