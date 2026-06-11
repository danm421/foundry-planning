import { NextResponse } from "next/server";
import { db } from "@/db";
import { tickerPortfolios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { computeAndCacheTickerPortfolioStats } from "@/lib/ticker-portfolio-compute";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    // 1. Verify portfolio ownership
    const [portfolio] = await db
      .select()
      .from(tickerPortfolios)
      .where(and(eq(tickerPortfolios.id, id), eq(tickerPortfolios.firmId, firmId)));

    if (!portfolio) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // 3. Derive asOfMonth from current clock
    const now = new Date();
    const asOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const { panel, lookThrough } = await computeAndCacheTickerPortfolioStats({
      portfolioId: id,
      firmId,
      asOfMonth,
    });

    // 9. Return stats + look-through
    return NextResponse.json({
      stats: panel.stats,
      window: {
        windowStart: panel.windowStart,
        windowEnd: panel.windowEnd,
        nMonths: panel.nMonths,
        limitingTicker: panel.limitingTicker,
        insufficientHistory: panel.insufficientHistory,
        shortHistory: panel.shortHistory,
      },
      lookThrough,
    });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/cma/ticker-portfolios/[id]/stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
