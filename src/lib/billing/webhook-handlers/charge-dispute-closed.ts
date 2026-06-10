import type Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

/**
 * charge.dispute.closed — the dispute reached a terminal outcome (won / lost /
 * warning_closed). We record the outcome for finance and downgrade the Sentry
 * page from the .created warning to an info-level resolution so ops can close
 * the loop. No automated funds action — Stripe already moved the money.
 */
export async function handleChargeDisputeClosed(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const dispute = await stripe.disputes.retrieve(
    (event.data.object as { id: string }).id,
  );
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const charge = await stripe.charges.retrieve(chargeId);
  const firmId =
    (charge.metadata as Record<string, string | undefined>).firm_id ?? "unknown";

  Sentry.captureMessage("Stripe dispute closed", {
    level: dispute.status === "lost" ? "warning" : "info",
    extra: {
      disputeId: dispute.id,
      chargeId,
      status: dispute.status,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      firmId,
    },
  });

  await recordAudit({
    action: "billing.dispute_closed",
    resourceType: "dispute",
    resourceId: dispute.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: {
      charge_id: chargeId,
      status: dispute.status,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
    },
  });
}
