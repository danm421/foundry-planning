import { type NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { tickerPortfolios, modelPortfolios } from "@/db/schema";
import { computeAndCacheTickerPortfolioStats } from "@/lib/ticker-portfolio-compute";
import { syncDerivedAllocations } from "@/lib/investments/sync-derived-model-portfolio";
import { liveSyncDeps } from "@/lib/investments/derived-model-portfolio-deps";

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

  let ok = 0;
  let failed = 0;
  for (const p of portfolios) {
    try {
      await computeAndCacheTickerPortfolioStats({ portfolioId: p.id, firmId: p.firmId, asOfMonth });

      // Re-derive the linked model portfolio so an EODHD reclassification
      // reaches plans without anyone editing the fund. A skipped re-sync is a
      // warning, not a failure: the prior allocations stay correct-as-of-last-
      // sync, which beats writing a mix we no longer trust.
      const [derived] = await db
        .select({ id: modelPortfolios.id })
        .from(modelPortfolios)
        .where(eq(modelPortfolios.sourceTickerPortfolioId, p.id));
      if (derived) {
        const outcome = await syncDerivedAllocations(
          { tickerPortfolioId: p.id, modelPortfolioId: derived.id, firmId: p.firmId },
          liveSyncDeps(),
        );
        if (!outcome.ok) {
          Sentry.captureMessage("Derived model portfolio re-sync skipped", {
            level: "warning",
            extra: {
              tickerPortfolioId: p.id,
              modelPortfolioId: derived.id,
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
