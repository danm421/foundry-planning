import type Stripe from "stripe";
import { handleSubscriptionUpsert } from "./customer-subscription-upserted";
import { handleSubscriptionDeleted } from "./customer-subscription-deleted";
import { handleTrialWillEnd } from "./customer-subscription-trial-will-end";
import { handleSubscriptionPaused } from "./customer-subscription-paused";
import { handleInvoiceUpserted } from "./invoice-upserted";
import { handleInvoicePaymentFailed } from "./invoice-payment-failed";
import { handleInvoicePaymentActionRequired } from "./invoice-payment-action-required";
import { handleChargeDisputeCreated } from "./charge-dispute-created";
import { handleCheckoutSessionCompleted } from "./checkout-session-completed";

export type WebhookHandler = (event: Stripe.Event) => Promise<void>;

/**
 * Dispatch table: Stripe event type → handler. Each handler is responsible
 * for re-fetching its live object from Stripe (never trust event.data.object).
 */
export const handlers: Partial<Record<string, WebhookHandler>> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "customer.subscription.created": handleSubscriptionUpsert,
  "customer.subscription.updated": handleSubscriptionUpsert,
  "customer.subscription.deleted": handleSubscriptionDeleted,
  "customer.subscription.paused": handleSubscriptionPaused,
  "customer.subscription.trial_will_end": handleTrialWillEnd,
  "invoice.created": handleInvoiceUpserted,
  "invoice.finalized": handleInvoiceUpserted,
  "invoice.paid": handleInvoiceUpserted,
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "invoice.payment_action_required": handleInvoicePaymentActionRequired,
  "charge.dispute.created": handleChargeDisputeCreated,
};
