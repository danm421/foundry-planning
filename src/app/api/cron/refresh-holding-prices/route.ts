import { type NextRequest, NextResponse } from "next/server";
import { eq, and, isNotNull, ne } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { accountHoldings, accounts, holdingPriceRefreshRuns } from "@/db/schema";
import { refreshHoldings } from "@/lib/investments/refresh-holdings";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/refresh-holding-prices — daily Vercel Cron (vercel.ts, 0 9 * * *).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). System job: operates across
 * ALL firms by design, so it does not go through per-user org scoping.
 *
 * Flow: load tickered holdings → batched Stooq fetch → plan changes (skip
 * unchanged date) → set-based bulk price update → re-sync each affected
 * holdings-driven account's value-weighted blend → record the run.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inserted = await db
    .insert(holdingPriceRefreshRuns)
    .values({ status: "running" })
    .returning({ id: holdingPriceRefreshRuns.id });
  const runId = inserted[0]?.id;

  try {
    const holdings = await db
      .select({
        id: accountHoldings.id,
        accountId: accountHoldings.accountId,
        displayTicker: accountHoldings.displayTicker,
        priceAsOf: accountHoldings.priceAsOf,
        deriveFromHoldings: accounts.deriveFromHoldings,
      })
      .from(accountHoldings)
      .innerJoin(accounts, eq(accounts.id, accountHoldings.accountId))
      .where(and(isNotNull(accountHoldings.displayTicker), ne(accountHoldings.displayTicker, "")));

    const summary = await refreshHoldings(holdings);
    const status = summary.resyncFailures.length > 0 ? "partial" : "ok";

    await db
      .update(holdingPriceRefreshRuns)
      .set({
        status,
        completedAt: new Date(),
        uniqueTickers: summary.uniqueTickers,
        tickersPriced: summary.tickersPriced,
        tickersMissing: summary.tickersMissing.length,
        holdingsUpdated: summary.holdingsUpdated,
        accountsResynced: summary.accountsResynced,
        failures:
          summary.resyncFailures.length > 0
            ? summary.resyncFailures.map((f) => ({ stage: "resync", ref: f.accountId, message: f.message }))
            : null,
      })
      .where(eq(holdingPriceRefreshRuns.id, runId));

    if (summary.resyncFailures.length > 0) {
      Sentry.captureMessage("Holding price refresh failures", {
        level: "warning",
        extra: { runId, count: summary.resyncFailures.length, sample: summary.resyncFailures.slice(0, 5) },
      });
    }

    return NextResponse.json(
      { runId, status, holdingsUpdated: summary.holdingsUpdated, accountsResynced: summary.accountsResynced },
      { status: 200 },
    );
  } catch (err) {
    // Top-level crash (e.g. the holdings load fails): don't leave the run row
    // stuck on "running". Best-effort mark it errored, page, return 500.
    await db
      .update(holdingPriceRefreshRuns)
      .set({
        status: "error",
        completedAt: new Date(),
        failures: [
          { stage: "run", ref: "-", message: err instanceof Error ? err.message.slice(0, 200) : "unknown" },
        ],
      })
      .where(eq(holdingPriceRefreshRuns.id, runId));
    Sentry.captureMessage("Holding price refresh crashed", {
      level: "error",
      extra: { runId, message: err instanceof Error ? err.message : "unknown" },
    });
    return NextResponse.json({ runId, status: "error" }, { status: 500 });
  }
}
