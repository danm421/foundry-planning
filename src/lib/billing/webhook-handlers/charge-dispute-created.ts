import type Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

/**
 * charge.dispute.created — manual ops review per runbook. We don't auto-
 * respond to disputes; this handler exists to put a Sentry-paged record in
 * front of someone and a structured audit row.
 */
export async function handleChargeDisputeCreated(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const dispute = await stripe.disputes.retrieve(
    (event.data.object as { id: string }).id,
  );
  // Disputes don't carry firm metadata directly — read from the related charge.
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const charge = await stripe.charges.retrieve(chargeId);
  const firmId = (charge.metadata as Record<string, string | undefined>).firm_id ?? "unknown";

  Sentry.captureMessage("Stripe dispute created", {
    level: "warning",
    extra: {
      disputeId: dispute.id,
      chargeId,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      firmId,
    },
  });

  await recordAudit({
    action: "billing.dispute_created",
    resourceType: "dispute",
    resourceId: dispute.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: {
      charge_id: chargeId,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
    },
  });
}
