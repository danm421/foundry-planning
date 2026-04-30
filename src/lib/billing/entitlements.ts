/**
 * Minimal view of a Stripe subscription item that entitlements logic needs.
 * Real callers map from either Stripe.SubscriptionItem (live API) or our
 * subscription_items rows (DB). Keeping the input shape small lets this
 * function stay pure and table-testable.
 */
export type StripeItemView = {
  kind: "seat" | "addon";
  addonKey: string | null;
  removed: boolean;
};

/**
 * Derive the Clerk-public-metadata `entitlements` array from a subscription's
 * line items. Pure function — no IO, no Date.now, no env reads.
 *
 * Excludes seat items (no entitlement attached), removed items, and addon
 * items missing an addon_key (which is itself a CHECK violation, but we
 * defend rather than throw so a corrupt payload can't break the webhook).
 *
 * Output is sorted + deduped so two equivalent line-item sets always produce
 * the same entitlements string when serialized into Clerk metadata —
 * stable diffs in the reconciliation cron.
 */
export function deriveEntitlements(items: StripeItemView[]): string[] {
  const addons = items
    .filter((i) => i.kind === "addon" && !i.removed && !!i.addonKey)
    .map((i) => i.addonKey as string);
  return Array.from(new Set(addons)).sort();
}
