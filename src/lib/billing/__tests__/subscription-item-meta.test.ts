import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { readSubscriptionItemMeta } from "../subscription-item-meta";

const item = (over: Record<string, unknown>) =>
  over as unknown as Stripe.SubscriptionItem;

describe("readSubscriptionItemMeta", () => {
  it("reads kind + addon_key from the expanded PRICE metadata", () => {
    expect(
      readSubscriptionItemMeta(
        item({
          metadata: {}, // Stripe leaves subscription-item metadata empty
          price: {
            id: "price_ai",
            metadata: { kind: "addon", addon_key: "ai_import" },
          },
        }),
      ),
    ).toEqual({ kind: "addon", addonKey: "ai_import" });
  });

  it("ignores subscription-item metadata — the source of the entitlement bug", () => {
    // Item metadata claims addon, but the PRICE says seat: price must win, or a
    // mis-stamped item could silently grant an entitlement.
    expect(
      readSubscriptionItemMeta(
        item({
          metadata: { kind: "addon", addon_key: "ai_import" },
          price: { id: "price_seat", metadata: { kind: "seat" } },
        }),
      ),
    ).toEqual({ kind: "seat", addonKey: null });
  });

  it("defaults to a seat with no addonKey when the price carries no metadata", () => {
    expect(
      readSubscriptionItemMeta(
        item({ metadata: {}, price: { id: "price_seat", metadata: {} } }),
      ),
    ).toEqual({ kind: "seat", addonKey: null });
  });

  it("falls back to seat when price is an unexpanded string id", () => {
    expect(
      readSubscriptionItemMeta(item({ metadata: {}, price: "price_seat" })),
    ).toEqual({ kind: "seat", addonKey: null });
  });
});
