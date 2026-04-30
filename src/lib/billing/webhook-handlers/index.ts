import type Stripe from "stripe";

export type WebhookHandler = (event: Stripe.Event) => Promise<void>;

/**
 * Dispatch table: Stripe event type → handler. Filled in by Tasks 9–17.
 * Phase 3 starts with this empty so the route's "ignored" branch is the
 * only path through new event types until each handler is wired.
 */
export const handlers: Partial<Record<string, WebhookHandler>> = {};
