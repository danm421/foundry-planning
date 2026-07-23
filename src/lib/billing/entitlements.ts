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

/** A manual entitlement override, reduced to what the pure derivation needs.
 *  Callers pass only ACTIVE, collapsed overrides (see src/lib/ops/entitlements.ts). */
export type EntitlementOverride = { entitlement: string; mode: "grant" | "revoke" };

export type EntitlementsInput = {
  items: StripeItemView[];
  /** Active manual overrides, applied as a FINAL step after seat/addon
   *  derivation, in array order (later entries win). A `grant` adds the key, a
   *  `revoke` removes it — so a revoke can strip a seat-included key. */
  overrides?: EntitlementOverride[];
};

/**
 * The always-on base entitlements — granted to EVERY org unconditionally,
 * regardless of subscription state (seat, founder/beta, or lapsed). AI document
 * import (`ai_import`) and Forge, the AI planning assistant (`ai_forge`), ship
 * with every plan; neither is a separate add-on or has a usage quota, so AI is a
 * universal capability rather than something a seat or beta code grants. An ops
 * `revoke` override is the only way to strip a base key from a specific firm.
 *
 * Dual-read transition (copilot → Forge rename): the legacy `ai_copilot` key is
 * still derived alongside `ai_forge` so reads that check either key keep passing
 * and no org loses access. `ai_copilot` is dropped from this list once every
 * org's Clerk metadata carries `ai_forge` (backfill + reconcile cron).
 */
export const BASE_ENTITLEMENTS = ["ai_import", "ai_forge", "ai_copilot"] as const;

/**
 * Derive the Clerk-public-metadata `entitlements` array from a subscription's
 * line items. Pure function — no IO, no Date.now, no env reads.
 *
 * Sources, applied in order:
 *  - BASE_ENTITLEMENTS are seeded unconditionally — AI ships with every org, so
 *    it is not gated on holding a seat (founder/beta and lapsed orgs get it too).
 *  - Any active `addon` item with an `addonKey` grants that key. This generic
 *    add-on support is retained for future add-ons; none ship today.
 *  - Any active manual override is applied last — `grant` adds the key,
 *    `revoke` removes it (a revoke can strip a base key: the ops kill switch).
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
  const set = new Set<string>(BASE_ENTITLEMENTS);
  for (const i of input.items) {
    if (i.kind === "addon" && !i.removed && i.addonKey) set.add(i.addonKey);
  }
  // Final step: union in manual overrides (grant adds, revoke removes). Applied
  // last so a revoke can strip a seat-included key and a grant can add one the
  // subscription does not imply. Order matters — later entries win.
  for (const o of input.overrides ?? []) {
    if (o.mode === "grant") set.add(o.entitlement);
    else set.delete(o.entitlement);
  }
  return Array.from(set).sort();
}
