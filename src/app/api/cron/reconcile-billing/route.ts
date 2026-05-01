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

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/reconcile-billing — daily Vercel Cron (configured in vercel.ts).
 *
 * Auth: Bearer token in `authorization` header equal to CRON_SECRET. Vercel
 * Cron auto-injects this when the route is referenced in the crons array.
 * Anyone hitting this without the bearer gets 401.
 *
 * Per-firm flow: re-fetch live Stripe sub → compare to DB rows + Clerk
 * metadata → push DriftEntry rows when sources disagree. We DO NOT auto-heal;
 * drift is recorded and Sentry-paged for ops review (CC7.1 detective control).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET ?? ""}`) {
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

      const dbItems: ReconcileItem[] = itemRows.map((r) => ({
        kind: r.kind as "seat" | "addon",
        addonKey: r.addonKey,
        quantity: r.quantity,
        removed: r.removedAt !== null,
      }));
      const stripeItems: ReconcileItem[] = stripeSub.items.data.map((it) => ({
        kind:
          ((it.metadata as Record<string, string | undefined>).kind as
            | "seat"
            | "addon") ?? "seat",
        addonKey:
          (it.metadata as Record<string, string | undefined>).addon_key ??
          null,
        quantity: it.quantity ?? 1,
        removed: false,
      }));

      drift.push(
        ...diffReconciliation({
          firmId: firm.firmId,
          stripe: { status: stripeSub.status, items: stripeItems },
          db: {
            status: liveSub.status,
            items: dbItems,
            aiImportsUsed: firm.aiImportsUsed,
          },
          clerk: {
            subscriptionStatus:
              typeof clerkMeta.subscription_status === "string"
                ? clerkMeta.subscription_status
                : "missing",
            entitlements: Array.isArray(clerkMeta.entitlements)
              ? (clerkMeta.entitlements as string[])
              : [],
          },
        }),
      );
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

  return NextResponse.json(
    { runId, status, discrepanciesFound: drift.length },
    { status: 200 },
  );
}
