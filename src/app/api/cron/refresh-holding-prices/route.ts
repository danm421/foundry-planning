import { type NextRequest, NextResponse } from "next/server";
import { eq, and, isNotNull, ne, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { accountHoldings, accounts, holdingPriceRefreshRuns } from "@/db/schema";
import { fetchEodCloses } from "@/lib/investments/quote";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import { planPriceUpdates, type HoldingPriceUpdate } from "@/lib/investments/price-refresh";

export const dynamic = "force-dynamic";

type Failure = { stage: "resync" | "run"; ref: string; message: string };

const UPDATE_CHUNK = 500;

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

  const failures: Failure[] = [];

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

    const tickers = holdings.map((h) => h.displayTicker as string);
    const uniqueTickers = new Set(holdings.map((h) => h.displayTicker as string)).size;
    const quotes = await fetchEodCloses(tickers);

    const { holdingUpdates, accountsToResync } = planPriceUpdates({ holdings, quotes });

    await bulkUpdatePrices(holdingUpdates);

    let accountsResynced = 0;
    for (const accountId of accountsToResync) {
      try {
        await syncAccountFromHoldings(accountId);
        accountsResynced += 1;
      } catch (err) {
        failures.push({
          stage: "resync",
          ref: accountId,
          message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });
      }
    }

    const status = failures.length > 0 ? "partial" : "ok";
    await db
      .update(holdingPriceRefreshRuns)
      .set({
        status,
        completedAt: new Date(),
        uniqueTickers,
        tickersPriced: quotes.size,
        tickersMissing: Math.max(0, uniqueTickers - quotes.size),
        holdingsUpdated: holdingUpdates.length,
        accountsResynced,
        failures: failures.length > 0 ? failures : null,
      })
      .where(eq(holdingPriceRefreshRuns.id, runId));

    if (failures.length > 0) {
      Sentry.captureMessage("Holding price refresh failures", {
        level: "warning",
        extra: { runId, count: failures.length, sample: failures.slice(0, 5) },
      });
    }

    return NextResponse.json(
      { runId, status, holdingsUpdated: holdingUpdates.length, accountsResynced },
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

/** Set-based bulk price update via UPDATE ... FROM (VALUES ...), chunked. */
async function bulkUpdatePrices(updates: HoldingPriceUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const chunk = updates.slice(i, i + UPDATE_CHUNK);
    if (chunk.length === 0) continue;
    const values = sql.join(
      chunk.map((u) => sql`(${u.id}::uuid, ${u.price}::numeric, ${u.asOf}::date)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE account_holdings AS h
      SET price = v.price, price_as_of = v.as_of, updated_at = now()
      FROM (VALUES ${values}) AS v(id, price, as_of)
      WHERE h.id = v.id
    `);
  }
}
