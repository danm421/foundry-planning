// src/lib/billing/purge-firm.ts
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { crmHouseholds, subscriptions, invoices, firms } from "@/db/schema";
import { purgeCrmHouseholdById } from "@/lib/crm/households";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

/**
 * Permanently purges one firm's PII once its retention window has elapsed.
 * Firm-agnostic so the cron can call it across firms. Honors the
 * privacy-policy deletion right (GDPR erasure):
 *
 *   1. Cascade-delete every household for the firm (drives planning clients +
 *      all CRM children via purgeCrmHouseholdById).
 *   2. Delete the firm's invoices + subscriptions mirror rows.
 *   3. Delete the Stripe customer (best-effort — already-deleted is fine).
 *   4. Delete the Clerk org.
 *   5. Stamp purgedAt on the firms row (the row itself is RETAINED as the
 *      purge record — auditor evidence the erasure ran). PII columns are
 *      already gone via the cascades above.
 *   6. Audit firm.purged.
 *
 * Steps 3-4 are wrapped so an external-system failure (e.g. Stripe customer
 * already deleted) does not abort the local purge or the purgedAt stamp.
 */
export async function purgeFirmById(firmId: string): Promise<void> {
  // 1. Households → planning clients → CRM children.
  const households = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, firmId));
  for (const h of households) {
    await purgeCrmHouseholdById(h.id, firmId);
  }

  // 2. Billing mirror rows.
  await db.delete(invoices).where(eq(invoices.firmId, firmId));

  const customerRows = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId));
  const stripeCustomerId = customerRows[0]?.stripeCustomerId ?? null;

  await db.delete(subscriptions).where(eq(subscriptions.firmId, firmId));

  // 3. Stripe customer (best-effort).
  if (stripeCustomerId) {
    try {
      await getStripe().customers.del(stripeCustomerId);
    } catch (err) {
      console.error(`[purge-firm] stripe.customers.del failed for ${firmId}:`, err);
    }
  }

  // 4. Clerk org (best-effort — org may already be gone).
  try {
    const cc = await clerkClient();
    await cc.organizations.deleteOrganization(firmId);
  } catch (err) {
    console.error(`[purge-firm] clerk deleteOrganization failed for ${firmId}:`, err);
  }

  // 5. Stamp the firms row (retained as the purge record).
  await db
    .update(firms)
    .set({ purgedAt: new Date(), updatedAt: new Date() })
    .where(eq(firms.firmId, firmId));

  // 6. Audit.
  await recordAudit({
    action: "firm.purged",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: "system:purge-cron",
    metadata: { households: households.length, stripeCustomerDeleted: !!stripeCustomerId },
  });
}
