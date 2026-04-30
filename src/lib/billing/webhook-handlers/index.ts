import type Stripe from "stripe";
import { handleSubscriptionUpsert } from "./customer-subscription-upserted";

export type WebhookHandler = (event: Stripe.Event) => Promise<void>;

/**
 * Dispatch table: Stripe event type → handler. Each handler is responsible
 * for re-fetching its live object from Stripe (never trust event.data.object).
 */
export const handlers: Partial<Record<string, WebhookHandler>> = {
  "customer.subscription.created": handleSubscriptionUpsert,
  "customer.subscription.updated": handleSubscriptionUpsert,
};
