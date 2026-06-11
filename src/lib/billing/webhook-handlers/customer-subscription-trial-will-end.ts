import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe-client";
import { sendBillingEmail } from "@/lib/billing/email-stub";
import { recordAudit } from "@/lib/audit";
import { resolveBillingContact } from "@/lib/billing/billing-contact";

/**
 * trial_will_end — Stripe fires this 3 days before trial conversion.
 * We queue a notification email (email-stub for now) and record the event
 * in audit. No subscription state change.
 */
export async function handleTrialWillEnd(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(
    (event.data.object as { id: string }).id,
  );
  const firmId = (sub.metadata as Record<string, string | undefined>).firm_id;
  if (!firmId) {
    throw new Error(`subscription ${sub.id} missing metadata.firm_id`);
  }

  const contact = await resolveBillingContact(firmId);
  const ownerEmail = contact?.email ?? undefined;

  if (ownerEmail) {
    await sendBillingEmail({
      kind: "trial_ending_3d",
      to: ownerEmail,
      firmId,
      payload: {
        trialEnd: sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null,
      },
    });
  }

  await recordAudit({
    action: "billing.subscription_updated",
    resourceType: "subscription",
    resourceId: sub.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: {
      event_kind: "trial_will_end",
      trial_end: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
    },
  });
}
