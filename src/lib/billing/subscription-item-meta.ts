import type Stripe from "stripe";

/**
 * Product taxonomy (`kind` / `addon_key`) for a Stripe subscription item.
 *
 * The tags live on the PRICE metadata — stamped when the price is created — NOT
 * on the subscription-item metadata, which Stripe leaves empty. Callers MUST
 * expand `items.data.price` for this to resolve.
 *
 * Reading `it.metadata` instead (the bug this helper exists to prevent)
 * silently labels every add-on as a seat, so `deriveEntitlements` — which only
 * credits items with `kind === "addon"` and an `addonKey` — never grants the
 * add-on's entitlement (e.g. `ai_import`). Funnel every reader through here so
 * the price-vs-item decision lives in exactly one place.
 */
export function readSubscriptionItemMeta(it: Stripe.SubscriptionItem): {
  kind: "seat" | "addon";
  addonKey: string | null;
} {
  const meta =
    typeof it.price === "object" && it.price ? it.price.metadata : null;
  return {
    kind: (meta?.kind as "seat" | "addon") ?? "seat",
    addonKey: meta?.addon_key ?? null,
  };
}
