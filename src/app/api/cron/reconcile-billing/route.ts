import { type NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  firms,
  subscriptions,
  subscriptionItems,
  reconciliationRuns,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import {
  diffReconciliation,
  type ReconcileItem,
  type DriftEntry,
} from "@/lib/billing/reconcile";
import { readSubscriptionItemMeta } from "@/lib/billing/subscription-item-meta";
import { getOrgMemberCount } from "@/lib/billing/seat-count";
import { checkRecentWebhookErrors } from "@/lib/billing/webhook-error-check";
import { getActiveEntitlementOverrides } from "@/lib/ops/entitlements";
import { recordAudit } from "@/lib/audit";
import { planAutoHeal } from "@/lib/billing/auto-heal";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/reconcile-billing — daily Vercel Cron (configured in vercel.ts).
 *
 * Auth: Bearer token in `authorization` header equal to CRON_SECRET. Vercel
 * Cron auto-injects this when the route is referenced in the crons array.
 * Anyone hitting this without the bearer gets 401.
 *
 * Per-firm flow: re-fetch live Stripe sub → compare to DB rows + Clerk
 * metadata → push DriftEntry rows when sources disagree. Status + entitlements
 * drift is auto-healed back to Clerk (Stripe is source of truth) and each heal
 * is audited; ambiguous item drift stays detect-only. All drift is still
 * recorded and Sentry-paged for ops review (CC7.1 detective control).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inserted = await db
    .insert(reconciliationRuns)
    .values({ status: "running" })
    .returning({ id: reconciliationRuns.id });
  const runId = inserted[0]?.id;

  const stripe = getStripe();
  const cc = await clerkClient();

  const candidateFirms = await db
    .select()
    .from(firms)
    .where(and(eq(firms.isFounder, false), isNull(firms.archivedAt)));

  const drift: DriftEntry[] = [];
  let checked = 0;
  for (const firm of candidateFirms) {
    try {
      const subRows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.firmId, firm.firmId));
      const liveSub = subRows.find((s) =>
        ["trialing", "active", "past_due", "unpaid", "paused"].includes(
          s.status,
        ),
      );
      if (!liveSub) continue;

      const itemRows = await db
        .select()
        .from(subscriptionItems)
        .where(eq(subscriptionItems.subscriptionId, liveSub.id));

      const stripeSub = await stripe.subscriptions.retrieve(
        liveSub.stripeSubscriptionId,
        { expand: ["items.data.price"] },
      );
      const org = await cc.organizations.getOrganization({
        organizationId: firm.firmId,
      });
      const clerkMeta = (org.publicMetadata ?? {}) as Record<string, unknown>;
      // Source-of-truth seat count. Passed into the diff so a billed seat
      // quantity that never got synced from real membership surfaces as drift
      // (detect-only) — the one check the Stripe↔DB mirror comparison can't make.
      const memberCount = await getOrgMemberCount(cc, firm.firmId);

      const dbItems: ReconcileItem[] = itemRows.map((r) => ({
        kind: r.kind as "seat" | "addon",
        addonKey: r.addonKey,
        quantity: r.quantity,
        removed: r.removedAt !== null,
      }));
      const stripeItems: ReconcileItem[] = stripeSub.items.data.map((it) => ({
        ...readSubscriptionItemMeta(it),
        quantity: it.quantity ?? 1,
        removed: false,
      }));

      const overrides = await getActiveEntitlementOverrides(firm.firmId);

      const firmDrift = diffReconciliation({
        firmId: firm.firmId,
        stripe: { status: stripeSub.status, items: stripeItems },
        db: {
          status: liveSub.status,
          items: dbItems,
        },
        clerk: {
          subscriptionStatus:
            typeof clerkMeta.subscription_status === "string"
              ? clerkMeta.subscription_status
              : "missing",
          entitlements: Array.isArray(clerkMeta.entitlements)
            ? (clerkMeta.entitlements as string[])
            : [],
          memberCount,
        },
        overrides,
      });
      drift.push(...firmDrift);

      // Auto-heal: write Stripe-derived status/entitlements back to Clerk on
      // drift (Stripe is source of truth). Item drift stays detect-only.
      const heal = planAutoHeal(firmDrift);
      if (heal) {
        // Clerk PATCH /metadata shallow-merges publicMetadata — only the keys
        // present in heal.patch are overwritten, so a status-only heal leaves
        // entitlements intact (and vice versa).
        await cc.organizations.updateOrganizationMetadata(firm.firmId, {
          publicMetadata: heal.patch,
        });
        await recordAudit({
          action: "billing.reconcile_healed",
          resourceType: "firm",
          resourceId: firm.firmId,
          firmId: firm.firmId,
          actorId: "system:reconcile-cron",
          metadata: { healedFields: heal.healedFields, patch: heal.patch },
        });
      }
      checked++;
    } catch (err) {
      drift.push({
        firmId: firm.firmId,
        field: "status",
        stripeValue: "<error>",
        clerkValue: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
    }
  }

  const status = drift.length > 0 ? "drift_detected" : "ok";
  await db
    .update(reconciliationRuns)
    .set({
      status,
      completedAt: new Date(),
      firmsChecked: checked,
      discrepanciesFound: drift.length,
      discrepancies: drift.length > 0 ? drift : null,
    })
    .where(eq(reconciliationRuns.id, runId));

  if (drift.length > 0) {
    Sentry.captureMessage("Billing reconciliation drift", {
      level: "warning",
      extra: { runId, count: drift.length, sample: drift.slice(0, 5) },
    });
  }

  // Observability is best-effort — a telemetry-query failure must not fail an
  // otherwise-successful reconcile run (which would trigger a wasteful Vercel
  // cron retry even though reconciliation already committed).
  let webhookErrors24h: number | null = null;
  try {
    webhookErrors24h = await checkRecentWebhookErrors();
  } catch (err) {
    console.error("[reconcile-billing] webhook error count failed:", err);
  }

  return NextResponse.json(
    { runId, status, discrepanciesFound: drift.length, webhookErrors24h },
    { status: 200 },
  );
}
