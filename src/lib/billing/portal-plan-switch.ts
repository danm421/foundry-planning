import type Stripe from "stripe";
import { getPriceCatalog } from "./price-catalog";

const DEFERRED_PURPOSE = "foundry_plan_switch_v1";
const IMMEDIATE_PURPOSE = "foundry_plan_switch_immediate_v1";
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
 *
 * There are two of them, and which one a session gets is the whole feature:
 *
 * - `deferToPeriodEnd: true` for a customer who has paid for a period that is
 *   still running. Annual -> monthly is both a smaller amount and a shorter
 *   interval, and applying that now does NOT leave the paid year alone:
 *   measured against Stripe, a $1,990 annual subscription ending 2027-09-18
 *   re-anchored to 2026-10-18 the moment the price changed, binning eleven
 *   paid months. `billing_cycle_anchor: "unchanged"` does not save it — the
 *   anchor day survives, the interval does not. So the change waits.
 *
 * - `deferToPeriodEnd: false` for a trial, which has paid for nothing and so
 *   has nothing to protect. Deferring here bought no one anything and made
 *   "Switch to monthly" look broken: Stripe scheduled the change silently and
 *   the billing page went on reading Annual until the trial ended.
 */
export async function getPlanSwitchPortalConfigurationId(
  stripe: Stripe,
  { deferToPeriodEnd }: { deferToPeriodEnd: boolean },
): Promise<string> {
  const purpose = deferToPeriodEnd ? DEFERRED_PURPOSE : IMMEDIATE_PURPOSE;
  const catalog = getPriceCatalog();
  const [monthly, annual, configurations] = await Promise.all([
    stripe.prices.retrieve(catalog.seatMonthly),
    stripe.prices.retrieve(catalog.seatAnnual),
    stripe.billingPortal.configurations.list({ active: true, limit: 100 }),
  ]);
  const products = productsForPrices(monthly, annual);
  const existing = configurations.data.find(
    (configuration) => configuration.metadata?.purpose === purpose,
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
      ...(deferToPeriodEnd
        ? {
            schedule_at_period_end: {
              conditions: [
                { type: "decreasing_item_amount" as const },
                { type: "shortening_interval" as const },
              ],
            },
          }
        : {}),
    },
  } satisfies NonNullable<PortalConfigurationUpdateParams["features"]>;

  const name = deferToPeriodEnd
    ? "Foundry billing-cycle changes"
    : "Foundry billing-cycle changes (immediate)";

  if (existing) {
    const updated = await stripe.billingPortal.configurations.update(existing.id, {
      features,
      name,
      metadata: { purpose },
    });
    return updated.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    features,
    name,
    metadata: { purpose },
  });
  return created.id;
}
