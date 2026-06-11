import { type NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { tickerPortfolios } from "@/db/schema";
import { computeAndCacheTickerPortfolioStats } from "@/lib/ticker-portfolio-compute";

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
