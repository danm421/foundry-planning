import { type NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { tickerPortfolios, modelPortfolios } from "@/db/schema";
import { computeAndCacheTickerPortfolioStats } from "@/lib/ticker-portfolio-compute";
import {
  liveSyncDeps,
  resyncDerivedForFund,
} from "@/lib/investments/derived-model-portfolio-deps";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/refresh-ticker-portfolios — monthly Vercel Cron (vercel.ts, 0 10 1 * *).
 * Auth: Bearer CRON_SECRET. System job across ALL firms. For every ticker portfolio,
 * refreshes cached price history (via loadTickerMonthlyReturns inside the compute
 * service) and recomputes + upserts ticker_portfolio_stats.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const asOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const portfolios = await db
    .select({ id: tickerPortfolios.id, firmId: tickerPortfolios.firmId })
    .from(tickerPortfolios);

  // Which funds back a model portfolio — one batched query, not one per
  // portfolio inside the loop. Almost every fund has no derived portfolio.
  const derivedRows = portfolios.length
    ? await db
        .select({
          id: modelPortfolios.id,
          sourceTickerPortfolioId: modelPortfolios.sourceTickerPortfolioId,
        })
        .from(modelPortfolios)
        .where(
          inArray(
            modelPortfolios.sourceTickerPortfolioId,
            portfolios.map((p) => p.id),
          ),
        )
    : [];
  const derivedByFund = new Map<string, string>();
  for (const row of derivedRows) {
    if (row.sourceTickerPortfolioId) derivedByFund.set(row.sourceTickerPortfolioId, row.id);
  }
  // One deps instance for the whole run: it memoizes each firm's slug map, which
  // is otherwise re-queried identically for every portfolio that firm owns.
  const deps = liveSyncDeps();

  let ok = 0;
  let failed = 0;
  for (const p of portfolios) {
    try {
      await computeAndCacheTickerPortfolioStats({ portfolioId: p.id, firmId: p.firmId, asOfMonth });

      // Re-derive the linked model portfolio so an EODHD reclassification
      // reaches plans without anyone editing the fund. A skipped re-sync is a
      // warning, not a failure: the prior allocations stay correct-as-of-last-
      // sync, which beats writing a mix we no longer trust.
      const derivedId = derivedByFund.get(p.id);
      if (derivedId) {
        const outcome = await resyncDerivedForFund(p.id, p.firmId, deps, derivedId);
        if (outcome && !outcome.ok) {
          Sentry.captureMessage("Derived model portfolio re-sync skipped", {
            level: "warning",
            extra: {
              tickerPortfolioId: p.id,
              modelPortfolioId: derivedId,
              reason: outcome.reason,
              unclassifiedWeight: outcome.unclassifiedWeight,
              droppedSlugs: outcome.droppedSlugs,
            },
          });
        }
      }
      ok++;
    } catch (err) {
      failed++;
      Sentry.captureMessage("Ticker-portfolio stats refresh failed", {
        level: "warning",
        extra: { portfolioId: p.id, message: err instanceof Error ? err.message : "unknown" },
      });
    }
  }

  return NextResponse.json({ status: failed > 0 ? "partial" : "ok", portfolios: portfolios.length, ok, failed });
}
