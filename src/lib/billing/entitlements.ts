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

export type EntitlementsInput = {
  items: StripeItemView[];
};

/**
 * Entitlements bundled into the base plan — granted to any firm holding an
 * active seat. AI document import (`ai_import`) and the planning copilot
 * (`ai_copilot`) both ship with every plan; neither is a separate add-on or
 * has a usage quota.
 */
export const SEAT_INCLUDED_ENTITLEMENTS = ["ai_import", "ai_copilot"] as const;

/**
 * Derive the Clerk-public-metadata `entitlements` array from a subscription's
 * line items. Pure function — no IO, no Date.now, no env reads.
 *
 * Two sources:
 *  - Any active (non-removed) `seat` item grants every entitlement in
 *    SEAT_INCLUDED_ENTITLEMENTS — holding a plan includes `ai_import`.
 *  - Any active `addon` item with an `addonKey` grants that key. This generic
 *    add-on support is retained for future add-ons; none ship today.
 *
 * Excludes removed items and addon items missing an addonKey (itself a CHECK
 * violation, but we defend rather than throw so a corrupt payload can't break
 * the webhook).
 *
 * Output is sorted + deduped so two equivalent inputs always produce the same
 * entitlements string when serialized into Clerk metadata — stable diffs in
 * the reconciliation cron.
 */
export function deriveEntitlements(input: EntitlementsInput): string[] {
  const set = new Set<string>();
  if (input.items.some((i) => i.kind === "seat" && !i.removed)) {
    for (const e of SEAT_INCLUDED_ENTITLEMENTS) set.add(e);
  }
  for (const i of input.items) {
    if (i.kind === "addon" && !i.removed && i.addonKey) set.add(i.addonKey);
  }
  return Array.from(set).sort();
}
