import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, subscriptionItems } from "@/db/schema";
import { getPriceCatalog } from "./price-catalog";

export type BillingPlan = "monthly" | "annual";

export function billingPlanForPriceId(priceId: string): BillingPlan | null {
  const catalog = getPriceCatalog();
  if (priceId === catalog.seatMonthly) return "monthly";
  if (priceId === catalog.seatAnnual) return "annual";
  return null;
}

/**
 * Read the public seat price from the local Stripe mirror. Webhooks keep this
 * row current, so the billing page does not need a Stripe round-trip to render.
 */
export async function getFirmBillingPlan(firmId: string): Promise<BillingPlan | null> {
  const row = await db
    .select({ stripePriceId: subscriptionItems.stripePriceId })
    .from(subscriptionItems)
    .innerJoin(subscriptions, eq(subscriptionItems.subscriptionId, subscriptions.id))
    .where(
      and(
        eq(subscriptionItems.firmId, firmId),
        eq(subscriptionItems.kind, "seat"),
        isNull(subscriptionItems.removedAt),
        inArray(subscriptions.status, ["trialing", "active", "past_due", "unpaid"]),
      ),
    )
    .orderBy(desc(subscriptions.createdAt), desc(subscriptionItems.updatedAt))
    .limit(1)
    .then((rows) => rows[0]);

  return row ? billingPlanForPriceId(row.stripePriceId) : null;
}
