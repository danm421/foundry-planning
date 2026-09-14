import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe-client";
import { sendBillingEmail } from "@/lib/billing/email-stub";
import { recordAudit } from "@/lib/audit";
import { resolveBillingContact } from "@/lib/billing/billing-contact";

/**
 * trial_will_end — Stripe fires this 3 days before trial conversion.
 * We queue a notification email (email-stub for now) and record the event
 * in audit. No subscription state change.
 *
 * The email says one of two opposite things, so `canceled` has to be read off
 * the live subscription rather than assumed: a trial with a cancellation
 * already scheduled will NOT convert, and telling that advisor their plan
 * renews automatically is backwards.
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

  // All three of Stripe's cancellation markers, because this account schedules
  // cancellations with `cancel_at` (a date) — which leaves cancel_at_period_end
  // false on a subscription that has genuinely been cancelled. Same reasoning
  // as lib/billing/trial-feedback.ts.
  const canceled =
    sub.cancel_at_period_end === true ||
    sub.canceled_at != null ||
    sub.cancel_at != null;

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
        canceled,
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
      canceled,
    },
  });
}
