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
  /**
   * Count of onboarding-mode imports already credited to this firm.
   * < AI_IMPORT_FREE_QUOTA grants the `ai_import` entitlement even without
   * a Stripe addon line — the switching-incentive branch from the pricing
   * spec.
   */
  aiImportsUsed: number;
};

export const AI_IMPORT_FREE_QUOTA = 3;

/**
 * Derive the Clerk-public-metadata `entitlements` array from a subscription's
 * line items + the firm's free-quota counter. Pure function — no IO, no
 * Date.now, no env reads.
 *
 * Excludes seat items (no entitlement attached), removed items, and addon
 * items missing an addon_key (which is itself a CHECK violation, but we
 * defend rather than throw so a corrupt payload can't break the webhook).
 *
 * Free-quota OR-in: the `ai_import` entitlement is also granted when
 * `aiImportsUsed < AI_IMPORT_FREE_QUOTA`, even without an active addon line.
 *
 * Output is sorted + deduped so two equivalent inputs always produce the
 * same entitlements string when serialized into Clerk metadata — stable
 * diffs in the reconciliation cron.
 */
export function deriveEntitlements(input: EntitlementsInput): string[] {
  const fromAddons = input.items
    .filter((i) => i.kind === "addon" && !i.removed && !!i.addonKey)
    .map((i) => i.addonKey as string);
  const set = new Set(fromAddons);
  if (input.aiImportsUsed < AI_IMPORT_FREE_QUOTA) {
    set.add("ai_import");
  }
  return Array.from(set).sort();
}
