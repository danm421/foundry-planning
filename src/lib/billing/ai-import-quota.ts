import { clerkClient } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { firms, clientImports, subscriptions } from "@/db/schema";
import {
  deriveEntitlements,
  type StripeItemView,
} from "@/lib/billing/entitlements";
import { getStripe } from "@/lib/billing/stripe-client";

type AnyTx = PgTransaction<
  NodePgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

/**
 * Atomically claim the free-quota credit for an onboarding-mode import that
 * just transitioned to status='committed'. Idempotent: re-running for the
 * same importId is a no-op (returns null).
 *
 * Returns the new ai_imports_used value when this call won the claim, or
 * null when nothing was credited (already counted, wrong mode, not yet
 * committed, or no firm row).
 *
 * Runs inside the caller-provided transaction so the credit lives or dies
 * with the import-commit. Race-free: the `ai_import_counted = false` check
 * inside the WHERE clause is the lock — only one transaction can flip it.
 */
export async function claimAiImportCredit(
  tx: AnyTx,
  importId: string,
): Promise<number | null> {
  const result = await tx.execute<{ ai_imports_used: number }>(sql`
    WITH claim AS (
      UPDATE ${clientImports}
      SET ai_import_counted = true,
          updated_at = now()
      WHERE ${clientImports.id} = ${importId}
        AND ${clientImports.mode} = 'onboarding'
        AND ${clientImports.aiImportCounted} = false
        AND ${clientImports.status} = 'committed'
      RETURNING ${clientImports.orgId} AS org_id
    )
    UPDATE ${firms}
    SET ai_imports_used = ai_imports_used + 1,
        updated_at = now()
    FROM claim
    WHERE ${firms.firmId} = claim.org_id
    RETURNING ai_imports_used
  `);
  const rows = (result as unknown as { rows?: { ai_imports_used: number }[] })
    .rows;
  if (!rows || rows.length === 0) return null;
  return rows[0].ai_imports_used;
}

/**
 * Re-derive entitlements from the firm's current Stripe subscription state
 * + ai_imports_used and push the result to Clerk org public metadata.
 *
 * Called by the import-commit route after a successful credit claim, so the
 * `ai_import` entitlement transition (free-quota → exhausted) is reflected
 * on the hot path within seconds rather than waiting for the next
 * subscription.updated webhook.
 *
 * No-ops when the firm has no live subscription row (e.g. founder orgs):
 * those orgs have entitlements managed by the founder-init script and do
 * not participate in the quota economy.
 */
export async function syncAiImportEntitlement(firmId: string): Promise<void> {
  const rows = await db
    .select({
      aiImportsUsed: firms.aiImportsUsed,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(firms)
    .leftJoin(subscriptions, eq(subscriptions.firmId, firms.firmId))
    .where(eq(firms.firmId, firmId))
    .then((r) => r);

  const row = rows[0];
  if (!row || !row.stripeSubscriptionId) return;

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  const itemsView: StripeItemView[] = sub.items.data.map((it) => ({
    kind: ((it.metadata?.kind as "seat" | "addon") ?? "seat") as
      | "seat"
      | "addon",
    addonKey: it.metadata?.addon_key ?? null,
    removed: false,
  }));
  const entitlements = deriveEntitlements({
    items: itemsView,
    aiImportsUsed: row.aiImportsUsed,
  });

  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: { entitlements },
  });
}
