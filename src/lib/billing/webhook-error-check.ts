import { and, eq, gte, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { billingEvents } from "@/db/schema";

/**
 * Counts Stripe webhook deliveries that ended in result='error' within the
 * last 24h and pages (Sentry error level) when that count is non-zero. Folded
 * into the daily reconcile-billing cron (no separate cron). Detective control
 * for the failure paths Stage 2 fixed — a non-zero count means a handler is
 * still throwing despite Stripe's retries.
 */
export async function checkRecentWebhookErrors(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.result, "error"),
        gte(billingEvents.receivedAt, sql`now() - interval '24 hours'`),
      ),
    );
  const count = rows[0]?.count ?? 0;
  if (count > 0) {
    Sentry.captureMessage("Stripe webhook errors in last 24h", {
      level: "error",
      extra: { count },
    });
  }
  return count;
}
