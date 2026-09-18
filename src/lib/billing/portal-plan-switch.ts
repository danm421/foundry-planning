import type Stripe from "stripe";
import { getPriceCatalog } from "./price-catalog";

const CONFIG_PURPOSE = "foundry_plan_switch_v1";
type PortalConfigurationUpdateParams = NonNullable<
  Parameters<Stripe["billingPortal"]["configurations"]["update"]>[1]
>;

function productId(price: Stripe.Price): string {
  return typeof price.product === "string" ? price.product : price.product.id;
}

function productsForPrices(monthly: Stripe.Price, annual: Stripe.Price) {
  const byProduct = new Map<string, string[]>();
  for (const price of [monthly, annual]) {
    const id = productId(price);
    byProduct.set(id, [...(byProduct.get(id) ?? []), price.id]);
  }
  return [...byProduct.entries()].map(([product, prices]) => ({
    product,
    prices,
    adjustable_quantity: { enabled: false },
  }));
}

/**
 * Use a dedicated portal configuration for billing-cycle changes. The normal
 * portal remains Dashboard-managed for cards, invoices and cancellation.
 * This configuration is app-owned so a price change during a free trial keeps
 * the original trial end instead of charging the customer early.
 */
export async function getPlanSwitchPortalConfigurationId(
  stripe: Stripe,
): Promise<string> {
  const catalog = getPriceCatalog();
  const [monthly, annual, configurations] = await Promise.all([
    stripe.prices.retrieve(catalog.seatMonthly),
    stripe.prices.retrieve(catalog.seatAnnual),
    stripe.billingPortal.configurations.list({ active: true, limit: 100 }),
  ]);
  const products = productsForPrices(monthly, annual);
  const existing = configurations.data.find(
    (configuration) => configuration.metadata?.purpose === CONFIG_PURPOSE,
  );
  const features = {
    payment_method_update: {
      enabled: true,
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      products,
      billing_cycle_anchor: "unchanged" as const,
      proration_behavior: "none" as const,
      trial_update_behavior: "continue_trial" as const,
      schedule_at_period_end: {
        conditions: [
          { type: "decreasing_item_amount" as const },
          { type: "shortening_interval" as const },
        ],
      },
    },
  } satisfies NonNullable<PortalConfigurationUpdateParams["features"]>;

  if (existing) {
    const updated = await stripe.billingPortal.configurations.update(existing.id, {
      features,
      name: "Foundry billing-cycle changes",
      metadata: { purpose: CONFIG_PURPOSE },
    });
    return updated.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    features,
    name: "Foundry billing-cycle changes",
    metadata: { purpose: CONFIG_PURPOSE },
  });
  return created.id;
}
