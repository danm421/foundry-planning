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
 * The client-portal capability key. Deliberately NOT in BASE_ENTITLEMENTS and
 * not tied to any Stripe price: `deriveEntitlements` seeds only the base set, so
 * omitting the key here is what makes the portal off for EVERY firm — no
 * migration and no backfill are involved. An ops `grant` override at
 * /admin/orgs/[firmId]/entitlements is the only way to turn it on today; if the
 * portal later becomes a paid add-on, an `addon` item carrying this addonKey
 * grants it through the existing add-on branch with no change here.
 */
export const CLIENT_PORTAL_ENTITLEMENT = "client_portal";

/**
 * Whether a firm's entitlements grant the client portal. Fails closed: a null,
 * undefined, or stale Clerk `entitlements` array reads as "not entitled" rather
 * than throwing, so a metadata gap locks the portal rather than opening it.
 */
export function hasClientPortalEntitlement(
  entitlements: string[] | null | undefined,
): boolean {
  return !!entitlements?.includes(CLIENT_PORTAL_ENTITLEMENT);
}

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

/**
 * Layer one user's active overrides on top of their firm's effective
 * entitlements. Pure — no IO, no Date.now, no env reads.
 *
 * `firmEntitlements` is the firm's ALREADY-DERIVED set: what
 * `deriveEntitlements` produced and `writeFirmEntitlements` mirrored into
 * Clerk. BASE_ENTITLEMENTS are deliberately NOT re-seeded here — the firm set
 * already carries them, and re-seeding would resurrect a base key that a
 * firm-level ops `revoke` had deliberately stripped.
 *
 * Overrides apply in array order, later entries winning: `grant` adds a key the
 * firm does not have, `revoke` removes one it does. Output is sorted and
 * deduped so two equivalent inputs compare equal.
 */
export function deriveUserEntitlements(input: {
  firmEntitlements: string[];
  overrides?: EntitlementOverride[];
}): string[] {
  const set = new Set(input.firmEntitlements);
  for (const o of input.overrides ?? []) {
    if (o.mode === "grant") set.add(o.entitlement);
    else set.delete(o.entitlement);
  }
  return Array.from(set).sort();
}
